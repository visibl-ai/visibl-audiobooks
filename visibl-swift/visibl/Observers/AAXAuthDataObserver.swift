//
//  AAXAuthDataObserver.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase
import FirebaseAuth
import Combine

final class AAXAuthDataObserver: ObservableObject {
    // MARK: - Properties
    
    @Published var aaxAuthData: AAXAuthData?
    public let objectWillChange = ObservableObjectPublisher()
    
    private let databaseManager = RTDBManager.shared
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var currentUserID: String?
    
    /// DatabaseHandle for the continuous observer on the `aaxAuthData` node.
    private var aaxAuthDataHandle: DatabaseHandle?
    
    // MARK: - Init / Deinit
    
    init() {
        subscribeForAuthStatus()
    }
    
    deinit {
        if let authHandle = authHandle {
            Auth.auth().removeStateDidChangeListener(authHandle)
        }
        
        unsubscribeAAXAuthData()
    }
    
    // MARK: - Auth Status Subscription
    
    private func subscribeForAuthStatus() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] auth, user in
            guard let self = self else { return }
            
            // If the user changes or signs out, remove existing subscription.
            if let oldUserID = self.currentUserID,
               oldUserID != user?.uid {
                self.cleanupForSignOut()
            }
            
            if let user = user {
                // New user signed in or changed
                self.currentUserID = user.uid
                self.subscribeForAAXAuthData(userID: user.uid)
            } else {
                // Signed out
                self.cleanupForSignOut()
            }
        }
    }
    
    /// Cleans up state/subscriptions when user signs out or changes
    private func cleanupForSignOut() {
        unsubscribeAAXAuthData()
        aaxAuthData = nil
        currentUserID = nil
    }
    
    /// Continuously monitors the `users/<userID>/aaxAuthData` path.
    /// If it doesn't exist, we treat that as no auth data available.
    /// If it exists, we update `aaxAuthData` accordingly.
    private func subscribeForAAXAuthData(userID: String) {
        let path = "users/\(userID)/aaxAuthData"
        let ref = Database.database().reference().child(path)
        ref.keepSynced(true)
        
        print("AAXAuthDataObserver: Subscribing for AAX auth data at \(path)")
        
        aaxAuthDataHandle = ref.observe(.value, with: { [weak self] snapshot in
            guard let self = self else { return }
            
            // If the node doesn't exist, snapshot.exists() == false.
            if !snapshot.exists() {
                // print("AAXAuthDataObserver: `aaxAuthData` is missing.")
                DispatchQueue.main.async {
                    self.aaxAuthData = nil
                    self.objectWillChange.send()
                }
                return
            }
            
            // If the node exists, parse it into AAXAuthData.
            guard let value = snapshot.value as? [String: Any] else {
                // print("AAXAuthDataObserver: Invalid data format for aaxAuthData")
                DispatchQueue.main.async {
                    self.aaxAuthData = nil
                    self.objectWillChange.send()
                }
                return
            }
            
            do {
                let data = try JSONSerialization.data(withJSONObject: value)
                let authData = try JSONDecoder().decode(AAXAuthData.self, from: data)
                // print("AAXAuthDataObserver: AAX auth data updated for user \(userID)")
                
                DispatchQueue.main.async {
                    self.aaxAuthData = authData
                    self.objectWillChange.send()
                }
            } catch {
                // print("AAXAuthDataObserver: Error parsing AAX auth data: \(error)")
                DispatchQueue.main.async {
                    self.aaxAuthData = nil
                    self.objectWillChange.send()
                }
            }
        })
    }
    
    /// Remove the observer from the `aaxAuthData` path if we have one.
    private func unsubscribeAAXAuthData() {
        guard let userID = currentUserID else { return }
        let path = "users/\(userID)/aaxAuthData"
        let ref = Database.database().reference().child(path)
        if let handle = aaxAuthDataHandle {
            ref.removeObserver(withHandle: handle)
            aaxAuthDataHandle = nil
            // print("AAXAuthDataObserver: Unsubscribed from AAX auth data.")
        }
    }
}

// MARK: - Convenience Methods

extension AAXAuthDataObserver {
    
    /// Computed property to check if user has valid AAX authentication
    var isAuthenticated: Bool {
        return aaxAuthData != nil
    }
    
    /// Computed property to get customer name if available
//    var customerName: String? {
//        guard let authData = aaxAuthData,
//              let nameValue = authData.customerInfo.name else {
//            return nil
//        }
//        
//        if let name = nameValue as? String {
//            return name
//        }
//        
//        return nil
//    }
    
    /// Computed property to check if tokens are expired
    var isTokenExpired: Bool {
        guard let authData = aaxAuthData else { return true }
        return Date().timeIntervalSince1970 >= authData.expires
    }
    
    /// Get the auth data as JSON Data for use with AAXConnectClient
    var authDataAsJSON: Data? {
        guard let authData = aaxAuthData else { return nil }
        
        do {
            return try JSONEncoder().encode(authData)
        } catch {
            print("AAXAuthDataObserver: Error encoding auth data to JSON: \(error)")
            return nil
        }
    }
}
