//
//  AuthService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth
import SwiftUI

class AuthService: AuthServiceProtocol {
    @AppStorage("anonymousUserUID") private var anonymousUserUID: String?
    private var cloudFunctionService = CloudFunctionService.shared
    private var authStateHandle: AuthStateDidChangeListenerHandle?
    
    init() {
        setupAuthStateListener()
    }
    
    deinit {
        if let handle = authStateHandle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }
    
    private func setupAuthStateListener() {
        authStateHandle = Auth.auth().addStateDidChangeListener { [weak self] (auth, user) in
            DispatchQueue.main.async {
                self?.handleAuthStateChange(user: user)
            }
        }
    }
    
    private func handleAuthStateChange(user: User?) {
        if let user = user {
            if let userID = getUserID() { AnalyticsManager.shared.identify(userId: userID) }
            print("User signed in: \(user.uid)")
        } else {
            AnalyticsManager.shared.reset()
            print("User signed out")
        }
    }
    
    func getUserID() -> String? {
        Auth.auth().currentUser?.uid
    }
    
    func isUserSignedIn() -> Bool {
        Auth.auth().currentUser != nil && !Auth.auth().currentUser!.isAnonymous
    }
    
    func getUserEmail() -> String? {
        Auth.auth().currentUser!.email
    }
    
    func signInAnonymously() async throws {
        if anonymousUserUID != nil { return }
        if  Auth.auth().currentUser != nil { return }
        try await Auth.auth().signInAnonymously()
        anonymousUserUID = Auth.auth().currentUser?.uid
        // No need to call identifyUser() here as the auth state listener will handle it
    }
    
    func isUserAnonymous() -> Bool {
        if let currentUser = Auth.auth().currentUser {
            return currentUser.isAnonymous
        } else {
            return false
        }
    }
    
    func signInWithEmail(email: String, password: String) async throws {
        do {
            try await Auth.auth().signIn(withEmail: email, password: password)
            // No need to call identifyUser() here as the auth state listener will handle it
        } catch {
            throw AuthError(error)
        }
    }
    
    func signUpWithEmail(email: String, password: String, confirmPassword: String) async throws {
        if password != confirmPassword { throw AuthError.passwordMismatch }
        do {
            try await Auth.auth().createUser(withEmail: email, password: password)
            // No need to call identifyUser() here as the auth state listener will handle it
        } catch {
            throw AuthError(error)
        }
    }
    
    func resetPassword(email: String) async throws {
        try await Auth.auth().sendPasswordReset(withEmail: email)
    }
    
    func signInWithGoogle(idToken: String, accessToken: String) async throws {
        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: accessToken
        )
        
        try await Auth.auth().signIn(with: credential)
        // No need to call identifyUser() here as the auth state listener will handle it
    }
    
    func signInWithApple(idToken: String) async throws {
        let credential = OAuthProvider.credential(
            providerID: AuthProviderID.apple,
            idToken: idToken
        )
        
        try await Auth.auth().signIn(with: credential)
        // No need to call identifyUser() here as the auth state listener will handle it
    }
    
    func signOut() async throws {
        try Auth.auth().signOut()
        anonymousUserUID = nil
        // No need to handle analytics reset here as the auth state listener will handle it
    }
    
    func deleteAccount() async throws {
        guard let user = Auth.auth().currentUser else { throw AuthError.deleteUserFailed }
        try await user.delete()
        anonymousUserUID = nil
        // No need to handle analytics reset here as the auth state listener will handle it
    }
    
    func lookupAccountByEmail(email: String) async throws -> Bool? {
        do {
            let response: UserLookupResponse = try await cloudFunctionService.makeAuthenticatedCall(
                includeRawData: true,
                functionName: "lookupAccountByEmail",
                with: ["email": email]
            )
            
            return response.exists
        } catch {
            print("Error during account lookup: \(error.localizedDescription)")
            return nil
        }
    }
    
    func migrateAnonymousData(anonUserUID: String, newUserUID: String) async throws {
        do {
            let response: UserMergeResponse = try await cloudFunctionService.makeAuthenticatedCall(
                includeRawData: true,
                functionName: "migrateAnonymousData",
                with: [
                    "uid": newUserUID,
                    "anonymousUid": anonUserUID
                ]
            )
            
            print(response)
        } catch {
            print(error.localizedDescription)
        }
    }
}
