//
//  SignInGoogleHelper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import GoogleSignIn

struct SignInGoogleResult {
    let idToken: String
    let accessToken: String
}

@MainActor
final class SignInGoogleHelper {
    func startSignInWithGoogleFlow() async throws -> SignInGoogleResult {
        try await withCheckedThrowingContinuation({ [weak self] continuation in
            self?.signInWithGoogleFlow { result in
                continuation.resume(with: result)
            }
        })
    }
    
    func signInWithGoogleFlow(completion: @escaping (Result<SignInGoogleResult, Error>) -> Void) {
        guard let topVC = UIWindowScene.topMostViewController() else {
            completion(.failure(NSError()))
            return
        }
        
        GIDSignIn.sharedInstance.signIn(withPresenting: topVC) { signInResult, error in
            guard let user = signInResult?.user, let idToken = user.idToken else {
                completion(.failure(error ?? NSError()))
                return
            }
            
            completion(.success(.init(idToken: idToken.tokenString, accessToken: user.accessToken.tokenString)))
        }
    }
}
