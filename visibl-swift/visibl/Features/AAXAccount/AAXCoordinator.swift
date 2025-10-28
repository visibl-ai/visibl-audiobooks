//
//  AAXCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

enum AAXDestination: Hashable, Equatable {
    case navigateToCountryList
    case navigateToWebview
}

class AAXCoordinator: ObservableObject {
    @Published var navigationPath = NavigationPath()
    
    func navigateBack() {
        navigationPath.removeLast()
    }
    
    func navigateToRoot() {
        navigationPath = NavigationPath()
    }
    
    func navigateToCountryList() {
        navigationPath.append(AAXDestination.navigateToCountryList)
    }
    
    func navigateToWebview() {
        navigationPath.append(AAXDestination.navigateToWebview)
    }
}
