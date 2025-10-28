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
    @ObservedObject private var networkManager = NetworkManager.shared
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
