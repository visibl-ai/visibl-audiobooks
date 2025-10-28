//
//  HapticFeedbackManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

final class HapticFeedback {
    static let shared = HapticFeedback()
    
    func trigger(style: UIImpactFeedbackGenerator.FeedbackStyle) {
        guard UserConfigurations.shared.isHapticTouchEnabled else { return }
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.impactOccurred()
    }
}
