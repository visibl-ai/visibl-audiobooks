//
//  MockAuthService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import XCTest
@testable import visibl

// A mock implementation of AuthServiceProtocol for testing
final class MockAuthService: AuthServiceProtocol {
    private(set) var isSignedIn = false
    private(set) var email: String? = nil
    private(set) var isAnonymous = false
    private(set) var anonymousUserUID: String? = nil
    
    // Control which calls should throw
    var shouldThrowOnSignIn = false
    var shouldThrowOnSignUp = false
    var shouldThrowOnReset = false
    var shouldThrowOnGoogle = false
    var shouldThrowOnApple = false
    var shouldThrowOnSignOut = false
    var shouldThrowOnDelete = false
    var shouldThrowOnAnonymous = false
    var shouldThrowOnLookup = false
    var shouldThrowOnMigrate = false

    func signInAnonymously() async throws {
        if shouldThrowOnAnonymous { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        if anonymousUserUID != nil { return }
        isAnonymous = true
        anonymousUserUID = "mock-anonymous-uid"
    }
    
    func isUserAnonymous() -> Bool {
        return isAnonymous
    }
    
    func lookupAccountByEmail(email: String) async throws -> Bool? {
        if shouldThrowOnLookup { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        // Simple mock implementation - return true for test@example.com
        return email == "test@example.com"
    }
    
    func migrateAnonymousData(anonUserUID: String, newUserUID: String) async throws {
        if shouldThrowOnMigrate { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        // Just mark anonymous as false after migration
        isAnonymous = false
        anonymousUserUID = nil
    }

    func isUserSignedIn() -> Bool {
        isSignedIn
    }

    func getUserEmail() -> String? {
        email
    }

    func signInWithEmail(email: String, password: String) async throws {
        if shouldThrowOnSignIn { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        isSignedIn = true
        self.email = email
    }

    func signUpWithEmail(email: String, password: String, confirmPassword: String) async throws {
        if password != confirmPassword {
            throw AuthError.passwordMismatch
        }
        if shouldThrowOnSignUp { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        isSignedIn = true
        self.email = email
    }

    func resetPassword(email: String) async throws {
        if shouldThrowOnReset { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        // no state change
    }

    func signInWithGoogle(idToken: String, accessToken: String) async throws {
        if shouldThrowOnGoogle { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        isSignedIn = true
        email = "google.user@example.com"
    }

    func signInWithApple(idToken: String) async throws {
        if shouldThrowOnApple { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        isSignedIn = true
        email = "apple.user@example.com"
    }

    func signOut() async throws {
        if shouldThrowOnSignOut { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        isSignedIn = false
        email = nil
    }

    func deleteAccount() async throws {
        if shouldThrowOnDelete { throw NSError(domain: "MockAuth", code: -1, userInfo: nil) }
        if !isSignedIn {
            throw AuthError.deleteUserFailed
        }
        isSignedIn = false
        email = nil
    }
}

final class AuthServiceTests: XCTestCase {
    var mockAuth: MockAuthService!

    override func setUp() {
        super.setUp()
        mockAuth = MockAuthService()
    }

    override func tearDown() {
        mockAuth = nil
        super.tearDown()
    }

    func testSignInSuccess() async throws {
        mockAuth.shouldThrowOnSignIn = false

        XCTAssertFalse(mockAuth.isUserSignedIn())
        try await mockAuth.signInWithEmail(email: "test@example.com", password: "password123")
        XCTAssertTrue(mockAuth.isUserSignedIn())
        XCTAssertEqual(mockAuth.getUserEmail(), "test@example.com")
    }

    func testSignInFailure() async {
        mockAuth.shouldThrowOnSignIn = true

        XCTAssertFalse(mockAuth.isUserSignedIn())
        do {
            try await mockAuth.signInWithEmail(email: "fail@example.com", password: "pwd")
            XCTFail("Expected signInWithEmail to throw")
        } catch {
            // expected
        }
        XCTAssertFalse(mockAuth.isUserSignedIn())
    }

    func testSignUpSuccess() async throws {
        mockAuth.shouldThrowOnSignUp = false

        try await mockAuth.signUpWithEmail(email: "new@example.com", password: "pw", confirmPassword: "pw")
        XCTAssertTrue(mockAuth.isUserSignedIn())
        XCTAssertEqual(mockAuth.getUserEmail(), "new@example.com")
    }

    func testSignUpPasswordMismatch() async {
        do {
            try await mockAuth.signUpWithEmail(email: "a@b.com", password: "pw1", confirmPassword: "pw2")
            XCTFail("Expected passwordMismatch error")
        } catch let error as AuthError {
            XCTAssertEqual(error, AuthError.passwordMismatch)
        } catch {
            XCTFail("Unexpected error type")
        }
        XCTAssertFalse(mockAuth.isUserSignedIn())
    }

    func testSignUpFailure() async {
        mockAuth.shouldThrowOnSignUp = true
        do {
            try await mockAuth.signUpWithEmail(email: "a@b.com", password: "pw", confirmPassword: "pw")
            XCTFail("Expected signUpWithEmail to throw")
        } catch {
            // expected
        }
        XCTAssertFalse(mockAuth.isUserSignedIn())
    }

    func testResetPasswordSuccess() async {
        mockAuth.shouldThrowOnReset = false
        do {
            try await mockAuth.resetPassword(email: "user@example.com")
            // If we reach here, no exception was thrown, which is what we want to test
        } catch {
            XCTFail("resetPassword threw an unexpected error: \(error)")
        }
    }

    func testResetPasswordFailure() async {
        mockAuth.shouldThrowOnReset = true
        do {
            try await mockAuth.resetPassword(email: "user@example.com")
            XCTFail("Expected resetPassword to throw")
        } catch {
            // expected
        }
    }

    func testSignInWithGoogleSuccess() async throws {
        mockAuth.shouldThrowOnGoogle = false

        try await mockAuth.signInWithGoogle(idToken: "token", accessToken: "token")
        XCTAssertTrue(mockAuth.isUserSignedIn())
        XCTAssertEqual(mockAuth.getUserEmail(), "google.user@example.com")
    }

    func testSignInWithGoogleFailure() async {
        mockAuth.shouldThrowOnGoogle = true
        do {
            try await mockAuth.signInWithGoogle(idToken: "token", accessToken: "token")
            XCTFail("Expected signInWithGoogle to throw")
        } catch {
            // expected
        }
        XCTAssertFalse(mockAuth.isUserSignedIn())
    }

    func testSignInWithAppleSuccess() async throws {
        mockAuth.shouldThrowOnApple = false

        try await mockAuth.signInWithApple(idToken: "token")
        XCTAssertTrue(mockAuth.isUserSignedIn())
        XCTAssertEqual(mockAuth.getUserEmail(), "apple.user@example.com")
    }

    func testSignInWithAppleFailure() async {
        mockAuth.shouldThrowOnApple = true
        do {
            try await mockAuth.signInWithApple(idToken: "token")
            XCTFail("Expected signInWithApple to throw")
        } catch {
            // expected
        }
        XCTAssertFalse(mockAuth.isUserSignedIn())
    }

    func testSignOutSuccess() async throws {
        // simulate signed in
        try await mockAuth.signInWithEmail(email: "user@example.com", password: "password")
        XCTAssertTrue(mockAuth.isUserSignedIn())

        try await mockAuth.signOut()
        XCTAssertFalse(mockAuth.isUserSignedIn())
        XCTAssertNil(mockAuth.getUserEmail())
    }

    func testSignOutFailure() async {
        mockAuth.shouldThrowOnSignOut = true
        do {
            try await mockAuth.signOut()
            XCTFail("Expected signOut to throw")
        } catch {
            // expected
        }
    }

    func testDeleteAccountSuccess() async throws {
        try await mockAuth.signInWithEmail(email: "del@example.com", password: "password")
        XCTAssertTrue(mockAuth.isUserSignedIn())

        try await mockAuth.deleteAccount()
        XCTAssertFalse(mockAuth.isUserSignedIn())
        XCTAssertNil(mockAuth.getUserEmail())
    }

    func testDeleteAccountFailureWhenNotSignedIn() async {
        XCTAssertFalse(mockAuth.isUserSignedIn())
        do {
            try await mockAuth.deleteAccount()
            XCTFail("Expected deleteAccount to throw")
        } catch let error as AuthError {
            XCTAssertEqual(error, AuthError.deleteUserFailed)
        } catch {
            XCTFail("Unexpected error type")
        }
    }

    func testDeleteAccountFailureOnError() async {
        do {
            try await mockAuth.signInWithEmail(email: "user@example.com", password: "password")
            mockAuth.shouldThrowOnDelete = true

            do {
                try await mockAuth.deleteAccount()
                XCTFail("Expected deleteAccount to throw")
            } catch {
                // We expect an error, but it could be either AuthError or NSError
            }
        } catch {
            XCTFail("Failed to sign in before testing delete: \(error)")
        }
    }
}
