//
//  ActionButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct ActionButton: View {
    let isDisabled: Bool
    let text: String
    let action: () -> Void
    
    init(
        isDisabled: Bool = false,
        text: String,
        action: @escaping () -> Void
    ) {
        self.isDisabled = isDisabled
        self.text = text
        self.action = action
    }
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .medium)
            action()
        }) {
            HStack(spacing: 12) {
                Text(text)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(isDisabled ? .white.opacity(0.5) : .white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background {
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isDisabled ? Color.gray.gradient : Color.customIndigo.gradient)
                        .glassEffect(in: .rect(cornerRadius: 12))
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isDisabled ? Color.gray.gradient : Color.customIndigo.gradient)
                }
            }
        }
        .disabled(isDisabled)
    }
}
