//
//  AuthError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth

enum AuthError: LocalizedError, Equatable {
    case passwordMismatch
    case deleteUserFailed
    case pleaseProvideCorrectEmail

    case invalidEmail
    case wrongPassword
    case userNotFound
    case expiredActionCode
    case invalidCredential
    case accountExistsWithDifferentCredential
    case emailAlreadyInUse
    case weakPassword
    case operationNotAllowed
    case tooManyRequests

    case unknown(message: String)

    init(_ error: Error) {
        let ns = error as NSError

        if let ae = error as? AuthError {
            self = ae
            return
        }

        if let code = AuthErrorCode(rawValue: ns.code) {
            switch code {
            case .invalidEmail:
                self = .invalidEmail
            case .wrongPassword:
                self = .wrongPassword
            case .userNotFound:
                self = .userNotFound
            case .expiredActionCode:
                self = .expiredActionCode
            case .invalidCredential:
                self = .invalidCredential
            case .accountExistsWithDifferentCredential:
                self = .accountExistsWithDifferentCredential
            case .emailAlreadyInUse:
                self = .emailAlreadyInUse
            case .weakPassword:
                self = .weakPassword
            case .operationNotAllowed:
                self = .operationNotAllowed
            case .tooManyRequests:
                self = .tooManyRequests
            default:
                self = .unknown(message: ns.localizedDescription)
            }
            return
        }

        self = .unknown(message: ns.localizedDescription)
    }

    var errorDescription: String? {
        switch self {
        case .passwordMismatch:
            return "auth_error_password_mismatch".localized
        case .deleteUserFailed:
            return "auth_error_delete_user_failed".localized
        case .pleaseProvideCorrectEmail:
            return "auth_error_please_provide_correct_email".localized

        case .invalidEmail:
            return "auth_error_invalid_email".localized
        case .wrongPassword:
            return "auth_error_wrong_password".localized
        case .userNotFound:
            return "auth_error_user_not_found".localized
        case .expiredActionCode:
            return "auth_error_expired_action_code".localized
        case .invalidCredential:
            return "auth_error_invalid_credential".localized
        case .accountExistsWithDifferentCredential:
            return "auth_error_account_exists_with_different_credential".localized
        case .emailAlreadyInUse:
            return "auth_error_email_already_in_use".localized
        case .weakPassword:
            return "auth_error_weak_password".localized
        case .operationNotAllowed:
            return "auth_error_operation_not_allowed".localized
        case .tooManyRequests:
            return "auth_error_too_many_requests".localized

        case .unknown(let message):
            return message
        }
    }
}
