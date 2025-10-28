//
//  AnalyticsManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import PostHog
import SwiftUI

final class AnalyticsManager: ObservableObject {
    static let shared = AnalyticsManager()
    
    @AppStorage("isPosthogEnabled") var isPosthogEnabled: Bool = true
    
    func setup() {
        if !isPosthogEnabled { return }
        let config = PostHogConfig(apiKey: Constants.posthogAPiKey, host: Constants.posthogHost)
        config.captureScreenViews = false
        config.sessionReplay = false
        config.sessionReplayConfig.maskAllTextInputs = true
        config.sessionReplayConfig.maskAllImages = false
        config.sessionReplayConfig.screenshotMode = true
        config.captureApplicationLifecycleEvents = true
        PostHogSDK.shared.setup(config)
    }
}

// User Identification

extension AnalyticsManager {
    func identify(userId: String) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.identify(userId)
    }
    
    func identify(userId: String, properties: [String: Any]) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.identify(userId)
    }
    
    func updateUserProperties(_ properties: [String: Any]) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.capture("$set", properties: ["$set": properties])
    }
    
    func reset() {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.reset()
    }
}

// Events Capture

extension AnalyticsManager {
    func captureEvent(_ eventName: String) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.capture(eventName)
    }
    
    func captureEvent(_ eventName: String, properties: [String: Any]) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.capture(eventName, properties: properties)
    }
    
    func captureScreenView(_ screenName: String) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.screen(screenName)
    }
    
    func captureScreenView(_ screenName: String, properties: [String: Any]) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.screen(screenName, properties: properties)
    }
    
    func captureButtonTap(_ buttonName: String) {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.capture("button_tapped", properties: ["button_name": buttonName])
    }
    
    func captureError(_ error: Error, context: [String: Any]? = nil) {
        if !isPosthogEnabled { return }
        
        var properties: [String: Any] = [
            "$exception_type": String(describing: type(of: error)),
            "$exception_message": error.localizedDescription,
            "$exception_fingerprint": "\(String(describing: type(of: error))):\(error.localizedDescription)"
        ]
        
        // Add stack trace if available
        if let nsError = error as NSError? {
            properties["$exception_stack_trace_raw"] = nsError.debugDescription
            properties["error_code"] = nsError.code
            properties["error_domain"] = nsError.domain
        }
        
        // Add additional context
        if let context = context {
            for (key, value) in context {
                properties[key] = value
            }
        }
        
        PostHogSDK.shared.capture("$exception", properties: properties)
    }
}

// Session Replay Controls

extension AnalyticsManager {
    func startSessionRecording() {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.startSessionRecording()
    }
    
    func stopSessionRecording() {
        if !isPosthogEnabled { return }
        PostHogSDK.shared.stopSessionRecording()
    }
    
    func isSessionReplayActive() -> Bool {
        if !isPosthogEnabled { return false }
        return PostHogSDK.shared.isSessionReplayActive()
    }
}

// MARK: - SwiftUI View Extensions

extension View {
    func trackScreenView(_ screenName: String) -> some View {
        self.onAppear {
            AnalyticsManager.shared.captureScreenView(screenName)
        }
    }
    
    func trackScreenView(_ screenName: String, properties: [String: Any]) -> some View {
        self.onAppear {
            AnalyticsManager.shared.captureScreenView(screenName, properties: properties)
        }
    }
    
    func trackButtonTap(_ buttonName: String) -> some View {
        self.simultaneousGesture(
            TapGesture().onEnded { _ in
                AnalyticsManager.shared.captureButtonTap(buttonName)
            }
        )
    }
}
