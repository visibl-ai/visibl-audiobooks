//
//  PlayerCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import SwiftUI

enum PlayerTabBarItem: String, Identifiable, CaseIterable {
    case bookInfo
    case styleList
    case generateNewStyle
    case shareVideo
    case timeSlider
    case sceneList
    // case grapgInfo
    
    var id: String { rawValue }
    
    var icon: String {
        switch self {
        case .bookInfo:
            return "house"
        case .styleList:
            return "paintbrush"
        case .generateNewStyle:
            return ""
        case .shareVideo:
            return "square.and.arrow.up"
        case .timeSlider:
            return "clock"
        case .sceneList:
            return ""
        }
    }
}

final class PlayerCoordinator: ObservableObject {
    @Published var selectedTab: PlayerTabBarItem = .bookInfo
    @Published var presentTableOfContents: Bool = false
    
    var showBlackOverlay: Bool {
        selectedTab == .sceneList
    }
    
    func selectTab(_ tab: PlayerTabBarItem) {
        withAnimation {
            self.selectedTab = tab
        }
    }
}
