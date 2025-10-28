//
//  UserConfigurations.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import SwiftUI

enum Language: String, CaseIterable {
    case en
}

final class UserConfigurations: ObservableObject {
    static let shared = UserConfigurations()
        
    // MARK: - Settings App Appearance and Behavior
    @AppStorage("isHapticTouchEnabled") var isHapticTouchEnabled: Bool = true
    @AppStorage("selectedAppearance") var selectedAppearance: AppAppearance = .system
    @AppStorage("displayCarouselOnHomeScreen") var displayCarouselOnHomeScreen: Bool = true
    @AppStorage("selectedLanguage") var selectedLanguage: Language = .en
    
    // MARK: - App Version and Build Bumber Fetch
    var appVersion: String { return Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }
    var buildNumber: String { return Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "" }
}
