//
//  TestEnvironment.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import UIKit
import FirebaseAuth

class TestEnvironment: ObservableObject {
    @Published var isTestReady = false
    
    func initTestEnvironment(diContainer: DIContainer) async {
        guard CommandLine.arguments.contains("--uitesting") else { return }
        
        print("Setting up for UI testing...")
        
        // Determine which test case we're running
        if let testCaseArg = CommandLine.arguments.first(where: { $0.starts(with: "--testCase=") }) {
            let testCaseName = String(testCaseArg.dropFirst("--testCase=".count))
            
            if let testCase = TestCase(rawValue: testCaseName) {
                switch testCase {
                case .testAudiobookAdd:
                    await setupForAudiobookAddTesting(diContainer: diContainer)
                case .testAudiobookPlayPause:
                    await setupForAudiobookPlayPauseTest(diContainer: diContainer)
                }
            } else {
                print("Unknown test case: \(testCaseName)")
                // Default to the add test setup
                await setupForAudiobookAddTesting(diContainer: diContainer)
            }
        } else {
            // No specific test case specified, default to the add test setup
            await setupForAudiobookAddTesting(diContainer: diContainer)
        }
    }
    
    private func setupForAudiobookAddTesting(diContainer: DIContainer) async {
        do {
            try await diContainer.authService.signOut()
            try await diContainer.authService.signInWithEmail(email: "test@example.com", password: "qwerty123")
            guard let userID = Auth.auth().currentUser?.uid else { return }
            let path = "users/\(userID)/library"
            try await RTDBManager.shared.deleteData(at: path)
            addTestReadyIndicator()
        } catch {
            print("Failed to set up test environment: \(error)")
        }
    }
    
    private func setupForAudiobookPlayPauseTest(diContainer: DIContainer) async {
        do {
            try await diContainer.authService.signOut()
            try await diContainer.authService.signInWithEmail(email: "test@example.com", password: "qwerty123")
            guard let userID = Auth.auth().currentUser?.uid else { return }
            let path = "users/\(userID)/library"
            try await RTDBManager.shared.deleteData(at: path)
            try await UserLibraryService.addAudiobookToUserLibrary(sku: "VISIBL_000002")
            addTestReadyIndicator()
        } catch {
            print("Failed to set up audiobook play test environment: \(error)")
        }
    }
    
    private func addTestReadyIndicator() {
        DispatchQueue.main.async {
            if let windowScene = UIApplication.shared.connectedScenes.first(where: {
                $0.activationState == .foregroundActive
            }) as? UIWindowScene,
               let window = windowScene.windows.first(where: { $0.isKeyWindow }) {
                
                print("UI TESTING MODE: Found active window")
                
                // Create visible indicator for UI tests
                let indicator = UILabel(frame: CGRect(x: 10, y: 10, width: 200, height: 30))
                indicator.text = "Test Ready"
                indicator.backgroundColor = .blue
                indicator.textColor = .red
                indicator.accessibilityIdentifier = "TestReadyIndicator"
                window.addSubview(indicator)
                
                self.isTestReady = true
                print("UI TESTING MODE: Added TestReadyIndicator to window")
            } else {
                print("UI TESTING MODE: ERROR - Could not find window to add indicator")
            }
        }
    }
}
