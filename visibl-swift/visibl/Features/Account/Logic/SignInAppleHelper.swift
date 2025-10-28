//
//  SignInAppleHelper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import AuthenticationServices

enum AppleSignInError: LocalizedError {
    case unknown           // 1000
    case canceled          // 1001
    case failed            // 1004
    case invalidResponse   // 1002
    case notHandled        // 1003
    case notInteractive    // 1006
    case credentialExport  // 2001
    case credentialImport  // 2002
    case matchedExcludedCredential // 2003

    init?(asAuthorizationError error: Error) {
        let ns = error as NSError
        guard ns.domain == ASAuthorizationError.errorDomain,
              let code = ASAuthorizationError.Code(rawValue: ns.code)
        else { return nil }

        switch code {
        case .unknown:
            self = .unknown
        case .canceled:
            self = .canceled
        case .failed:
            self = .failed
        case .invalidResponse:
            self = .invalidResponse
        case .notHandled:
            self = .notHandled
        case .notInteractive:
            self = .notInteractive
        case .credentialExport:
            self = .credentialExport
        case .credentialImport:
            self = .credentialImport
        case .matchedExcludedCredential:
            self = .matchedExcludedCredential
        @unknown default:
            self = .unknown
        }
    }

    var errorDescription: String? {
        switch self {
        case .unknown:
            return "apple_sign_in_error_unknown".localized
        case .canceled:
            return "apple_sign_in_error_canceled".localized
        case .failed:
            return "apple_sign_in_error_failed".localized
        case .invalidResponse:
            return "apple_sign_in_error_invalid_response".localized
        case .notHandled:
            return "apple_sign_in_error_not_handled".localized
        case .notInteractive:
            return "apple_sign_in_error_not_interactive".localized
        case .credentialExport:
            return "apple_sign_in_error_credential_export".localized
        case .credentialImport:
            return "apple_sign_in_error_credential_import".localized
        case .matchedExcludedCredential:
            return "apple_sign_in_error_excluded_credential".localized
        }
    }
}

struct SignInAppleResult {
    let idToken: String
    let fullName: PersonNameComponents?
    let email: String?
}

@MainActor
final class SignInAppleHelper: NSObject, ASAuthorizationControllerDelegate {
    private var continuation: CheckedContinuation<SignInAppleResult, Error>?
    
    func startSignInWithAppleFlow() async throws -> SignInAppleResult {
        try await withCheckedThrowingContinuation { [weak self] continuation in
            self?.continuation = continuation
            self?.signInWithAppleFlow()
        }
    }
    
    private func signInWithAppleFlow() {
        guard let topViewController = UIWindowScene.topMostViewController() else {
            continuation?.resume(throwing: NSError(
                domain: "AppleSignIn",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unable to find top-most view controller."]
            ))
            
            return
        }
        
        let appleIDProvider = ASAuthorizationAppleIDProvider()
        let request = appleIDProvider.createRequest()
        request.requestedScopes = [.fullName, .email]
        
        let authorizationController = ASAuthorizationController(authorizationRequests: [request])
        authorizationController.delegate = self
        authorizationController.presentationContextProvider = topViewController as? ASAuthorizationControllerPresentationContextProviding
        authorizationController.performRequests()
    }
    
    // MARK: - ASAuthorizationControllerDelegate
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityTokenData = appleIDCredential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            continuation?.resume(throwing: NSError(
                domain: "AppleSignIn",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unable to retrieve Apple Sign In credentials"]
            ))
            
            return
        }
        
        print("Identity Token: \(identityToken)")
        
        let result = SignInAppleResult(
            idToken: identityToken,
            fullName: appleIDCredential.fullName,
            email: appleIDCredential.email
        )
        
        continuation?.resume(returning: result)
    }
    
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        continuation?.resume(throwing: mapASAuthorizationError(error))
    }
    
    private func mapASAuthorizationError(_ error: Error) -> Error {
        if let appleError = AppleSignInError(asAuthorizationError: error) { return appleError }
        return error
    }
}
