//
//  NotificationPermissionManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import UserNotifications
import UIKit

final class NotificationPermissionManager {
    static let shared = NotificationPermissionManager()

    private let userDefaults = UserDefaults.standard
    private let hasRequestedPermissionKey = "hasRequestedNotificationPermission"

    private init() {}

    /// Check if we've already requested notification permissions from the user
    var hasRequestedPermission: Bool {
        get { userDefaults.bool(forKey: hasRequestedPermissionKey) }
        set { userDefaults.set(newValue, forKey: hasRequestedPermissionKey) }
    }

    /// Request notification permission if we haven't already asked the user, and register for remote notifications if authorized
    func requestPermissionIfNeeded() {
        // Skip if running UI tests
        guard !CommandLine.arguments.contains("--uitesting") else { return }

        // Check current permission status
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            guard let self = self else { return }

            switch settings.authorizationStatus {
            case .notDetermined:
                // Only request if we haven't asked before
                if !self.hasRequestedPermission {
                    self.requestPermission()
                }
            case .authorized, .provisional, .ephemeral:
                // Always register for remote notifications when authorized
                // This handles users who enabled notifications in Settings after initially denying
                self.hasRequestedPermission = true
                self.registerForRemoteNotifications()
            case .denied:
                // User denied, mark as requested so we don't keep asking
                self.hasRequestedPermission = true
            @unknown default:
                break
            }
        }
    }

    /// Register for remote notifications if currently authorized (should be called on app launch for logged-in users)
    func registerIfAuthorized() {
        // Skip if running UI tests
        guard !CommandLine.arguments.contains("--uitesting") else { return }

        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            guard let self = self else { return }

            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                // Register for remote notifications if we have permission
                self.registerForRemoteNotifications()
            default:
                break
            }
        }
    }

    /// Request notification authorization from the user
    private func requestPermission() {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, error in
                guard let self = self else { return }

                // Mark that we've requested permission
                self.hasRequestedPermission = true

                if let error = error {
                    print("Notification authorization error: \(error.localizedDescription)")
                    return
                }

                if granted {
                    print("APNS authorization granted")
                    self.registerForRemoteNotifications()
                } else {
                    print("APNS authorization denied")
                }
            }
    }

    /// Register for remote push notifications
    private func registerForRemoteNotifications() {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Reset the permission tracking (useful for testing or account deletion)
    func resetPermissionTracking() {
        hasRequestedPermission = false
    }
}
