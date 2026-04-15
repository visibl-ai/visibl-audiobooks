//
//  HapticFeedbackManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct HapticFeedback {
    static func trigger(style: UIImpactFeedbackGenerator.FeedbackStyle) {
        guard UserConfigurations.shared.isHapticTouchEnabled else { return }
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }
}
