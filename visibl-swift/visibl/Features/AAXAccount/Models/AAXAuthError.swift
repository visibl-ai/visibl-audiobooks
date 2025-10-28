//
//  AAXAuthError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum AAXAuthError: LocalizedError {
    case authenticationFailed
    case clientNotInitialized
    case accountIsLinkedToAnotherUser
    
    var errorDescription: String? {
        switch self {
        case .authenticationFailed:
            return "aax_errors_authenticationFailed".localized
        case .clientNotInitialized:
            return "aax_errors_clientNotInitialized".localized
        case .accountIsLinkedToAnotherUser:
            return "aax_errors_accountIsLinkedToAnotherUser".localized
        }
    }
}
