//
//  AuthViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth
import SwiftUI

enum AuthState: Hashable {
    case auth
    case passwordResetSuccess
    case profile
}

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var authState: AuthState = .auth
    @Published var email: String = ""
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    private let signInGoogle: SignInGoogleHelper
    private let signInApple: SignInAppleHelper
    private let authService: AuthServiceProtocol
    @AppStorage("anonymousUserUID") private var anonymousUserUID: String?
    
    private let player: AudioPlayerManager
    private let userConfig = UserConfigurations.shared
    
    init(
        authService: AuthServiceProtocol,
        player: AudioPlayerManager
    ) {
        self.authService = authService
        self.player = player
        self.signInGoogle = SignInGoogleHelper()
        self.signInApple = SignInAppleHelper()
        if authService.isUserSignedIn() { authState = .profile }
    }
    
    func signInWithEmailAndPassword(email: String, password: String, completion: @escaping (Bool) -> Void) {
        Task {
            do {
                withAnimation(.easeInOut) { isLoading = true }
                try await authService.signInWithEmail(email: email, password: password)
                try await mergeAnonymousUser()
                withAnimation(.easeInOut(duration: 0.25)) { authState = .profile }
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .success, message: "toast_successfully_signed_in_with_email".localized)
                completion(true)
            } catch {
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .error, message: error.localizedDescription)
                print(error.localizedDescription)
                completion(false)
            }
        }
    }
    
    func signUpWithEmailAndPassword(email: String, password: String, confirmPassword: String, completion: @escaping (Bool) -> Void) {
        Task {
            do {
                withAnimation(.easeInOut) { isLoading = true }
                try await authService.signUpWithEmail(email: email, password: password, confirmPassword: confirmPassword)
                try await mergeAnonymousUser()
                withAnimation(.easeInOut(duration: 0.25)) { authState = .profile }
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .success, message: "toast_successfully_signed_up_with_email".localized)
                completion(true)
            } catch {
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .error, message: error.localizedDescription)
                print(error.localizedDescription)
                completion(false)
            }
        }
    }
    
    func signInWithGoogle(completion: @escaping (Bool) -> Void) {
        Task {
            do {
                withAnimation(.easeInOut) { isLoading = true }
                let googleResult = try await signInGoogle.startSignInWithGoogleFlow()
                try await authService.signInWithGoogle(
                    idToken: googleResult.idToken,
                    accessToken: googleResult.accessToken
                )
                try await mergeAnonymousUser()
                withAnimation(.easeInOut(duration: 0.25)) { authState = .profile }
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .success, message: "toast_successfully_signed_in_with_google".localized)
                completion(true)
            } catch {
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .error, message: error.localizedDescription)
                completion(false)
            }
        }
    }
    
    func signInWithApple(completion: @escaping (Bool) -> Void) {
        Task {
            do {
                withAnimation(.easeInOut) { isLoading = true }
                let appleResult = try await signInApple.startSignInWithAppleFlow()
                try await authService.signInWithApple(idToken: appleResult.idToken)
                try await mergeAnonymousUser()
                withAnimation(.easeInOut(duration: 0.25)) { authState = .profile }
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .success, message: "toast_successfully_signed_in_with_apple".localized)
                completion(true)
            } catch {
                withAnimation(.easeInOut) { isLoading = false }
                Toastify.show(style: .error, message: error.localizedDescription)
                print(error.localizedDescription)
                completion(false)
            }
        }
    }
    
    func resetPassword(email: String) async {
        do {
            withAnimation(.easeInOut) { isLoading = true }
            try await authService.resetPassword(email: email)
            withAnimation(.easeInOut(duration: 0.25)) { authState = .passwordResetSuccess }
            withAnimation(.easeInOut) { isLoading = false }
        } catch {
            withAnimation(.easeInOut) { isLoading = false }
            Toastify.show(style: .error, message: error.localizedDescription)
            print(error.localizedDescription)
        }
    }
    
    func signOut() async {
        do {
            withAnimation(.easeInOut) { isLoading = true }
            try await authService.signOut()
            player.stop()
            SDDownloadManagerWrapper.shared.cancelAllDownloads()
            try await authService.signInAnonymously()
            withAnimation(.easeInOut(duration: 0.25)) { authState = .auth }
            withAnimation(.easeInOut) { isLoading = false }
        } catch {
            withAnimation(.easeInOut) { isLoading = false }
            Toastify.show(style: .error, message: error.localizedDescription)
            print(error.localizedDescription)
        }
    }
    
    func deleteAccount() async {
        do {
            withAnimation(.easeInOut) { isLoading = true }
            player.stop()
            SDDownloadManagerWrapper.shared.cancelAllDownloads()
            try await authService.deleteAccount()
            try await authService.signInAnonymously()
            withAnimation(.easeInOut(duration: 0.25)) { authState = .auth }
            withAnimation(.easeInOut) { isLoading = false }
        } catch {
            withAnimation(.easeInOut) { isLoading = false }
            Toastify.show(style: .error, message: error.localizedDescription)
            print(error.localizedDescription)
        }
    }
}

extension AuthViewModel {
    func mergeAnonymousUser() async throws {
        guard let anonUID = anonymousUserUID else {
            print("No anonymous user UID available")
            return
        }
        
        guard let currentUser = Auth.auth().currentUser else {
            print("No authenticated user found")
            return
        }
        
        try await authService.migrateAnonymousData(
            anonUserUID: anonUID,
            newUserUID: currentUser.uid
        )
    }
    
    func doesUserExist() async -> Bool? {
        if !isValidEmail(email) {
            Toastify.show(style: .error, message: AuthError.pleaseProvideCorrectEmail.localizedDescription)
            return nil
        }
        
        do {
            withAnimation(.easeInOut) { isLoading = true }
            if email.isEmpty { return nil }
            let result = try await authService.lookupAccountByEmail(email: email)
            withAnimation(.easeInOut) { isLoading = false }
            return result
        } catch {
            print(error.localizedDescription)
            withAnimation(.easeInOut) { isLoading = false }
            return nil
        }
    }
}

extension AuthViewModel {
    /// Returns true if `email` is in a valid “name@domain.tld” format.
    func isValidEmail(_ email: String) -> Bool {
        // A reasonably forgiving RFC-2822-style regex
        let pattern =
        #"^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#
        let predicate = NSPredicate(format: "SELF MATCHES %@", pattern)
        return predicate.evaluate(with: email)
    }
}
