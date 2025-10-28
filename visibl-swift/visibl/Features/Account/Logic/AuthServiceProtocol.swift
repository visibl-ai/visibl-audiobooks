//
//  AuthServiceProtocol.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

protocol AuthServiceProtocol {
    func isUserSignedIn() -> Bool
    func getUserID() -> String?
    func getUserEmail() -> String?
    func signInWithEmail(email: String, password: String) async throws
    func signUpWithEmail(email: String, password: String, confirmPassword: String) async throws
    func resetPassword(email: String) async throws
    func signInWithGoogle(idToken: String, accessToken: String) async throws
    func signInWithApple(idToken: String) async throws
    func signOut() async throws
    func deleteAccount() async throws
    func signInAnonymously() async throws
    func isUserAnonymous() -> Bool
    func lookupAccountByEmail(email: String) async throws -> Bool?
    func migrateAnonymousData(anonUserUID: String, newUserUID: String) async throws
}
