//
//  PlayerActionButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerActionButton: View {
    let text: String
    let action: () -> Void
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .light)
            action()
        }) {
            HStack(spacing: 12) {
                Text(text)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background {
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.customIndigo.gradient)
                        .glassEffect(in: .rect(cornerRadius: 12))
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.customIndigo.gradient)
                }
            }
        }
    }
}
