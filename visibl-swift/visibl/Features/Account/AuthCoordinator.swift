//
//  AuthCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

enum AuthDestination: Hashable, Equatable {
    case navigateToSignIn
    case navigateToSignUp
    case navigateToPasswordReset
}

class AuthCoordinator: ObservableObject {
    @Published var navigationPath = NavigationPath()
    
    func navigateBack() {
        navigationPath.removeLast()
    }
    
    func navigateToRoot() {
        navigationPath = NavigationPath()
    }
    
    func navigateToSignIn() {
        navigationPath.append(AuthDestination.navigateToSignIn)
    }
    
    func navigateToSignUp() {
        navigationPath.append(AuthDestination.navigateToSignUp)
    }
    
    func navigateToPasswordReset() {
        navigationPath.append(AuthDestination.navigateToPasswordReset)
    }
}
