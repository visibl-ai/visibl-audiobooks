//
//  VisiblApp.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import FirebaseAuth
import FirebaseDatabase

@main
struct VisiblApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appCoordinator = AppCoordinator()
    private let networkManager = NetworkManager.shared
    @StateObject private var testEnvironment = TestEnvironment()
    private let diContainer: DIContainer

    init() {
        diContainer = DIContainer()
        configureNavigationBarAppearance()
    }
    
    var body: some Scene {
        WindowGroup {
            TabbarView(
                appCoordinator: appCoordinator,
                diContainer: diContainer
            )
            .onAppear {
                #if DEBUG
                print("📁 App Container: \(NSHomeDirectory())")
                #endif
                networkManager.startMonitoring()
                diContainer.aaxClient.checkAuthenticationStatus()
                applyAppearance()
                checkNotificationPermissionsForLoggedInUser()
            }
            .task {
                if CommandLine.arguments.contains("--uitesting") {
                    await testEnvironment.initTestEnvironment(diContainer: diContainer)
                } else {
                    Task {
                        await createAnonymousForUser()
                    }
                }
            }
        }
    }
}

extension VisiblApp {
    private func createAnonymousForUser() async {
        do {
            try await diContainer.authService.signInAnonymously()
        } catch {
            print(error.localizedDescription)
        }
    }

    /// Check if user is already logged in and request notification permissions if needed
    /// This handles existing users who upgrade to the new version
    /// Also ensures we register for remote notifications on every launch if authorized
    private func checkNotificationPermissionsForLoggedInUser() {
        // If user is signed in (not anonymous), request permission if we haven't already
        if diContainer.authService.isUserSignedIn() {
            // This will: 1) Ask for permission if not yet asked, OR 2) Register if already authorized
            // The second case handles users who enabled notifications in Settings after denying
            NotificationPermissionManager.shared.requestPermissionIfNeeded()
        }
    }
}

extension VisiblApp {
    private func configureNavigationBarAppearance() {
        let appearance = UINavigationBar.appearance()
        
        appearance.largeTitleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 36, weight: .bold).withSerifDesign()
        ]
        
        appearance.titleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 18, weight: .regular).withSerifDesign()
        ]
    }
    
    private func applyAppearance() {
        DispatchQueue.main.async {
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let window = windowScene.windows.first {
                switch UserConfigurations.shared.selectedAppearance {
                case .light:
                    window.overrideUserInterfaceStyle = .light
                case .dark:
                    window.overrideUserInterfaceStyle = .dark
                case .system:
                    window.overrideUserInterfaceStyle = .unspecified
                }
            }
        }
    }
}
