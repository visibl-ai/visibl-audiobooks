//
//  SettingsViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth
import SwiftUI

@MainActor
final class SettingsViewModel: ObservableObject {
    func copyUserUIDToClipboard() {
        let uid = Auth.auth().currentUser?.uid ?? "No user"
        UIPasteboard.general.string = uid
        
        HapticFeedback.shared.trigger(style: .light)
        Toastify.show(
            style: .success,
            message: "User's UID copied to clipboard"
        )
        
        print("User's UID copied to clipboard: \(uid)")
    }
    
    func printBundleID() {
        let bundleIdentifier = Bundle.main.bundleIdentifier ?? "Unknown Bundle ID"
        print("Bundle Identifier: \(bundleIdentifier)")
    }
}
