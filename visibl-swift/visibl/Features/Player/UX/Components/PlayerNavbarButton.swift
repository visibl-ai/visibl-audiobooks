//
//  PlayerNavbarButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Shimmer

struct PlayerNavbarButton: View {
    let isLoading: Bool
    let text: String
    let alignment: Alignment
    let action: () -> Void
    
    let buttonHeight: CGFloat = 36
    let buttonWidth: CGFloat = 80
    let cornerRadius: CGFloat = 8
    
    init(
        isLoading: Bool,
        text: String,
        alignment: Alignment,
        action: @escaping () -> Void = {}
    ) {
        self.isLoading = isLoading
        self.text = text
        self.alignment = alignment
        self.action = action
    }
    
    var body: some View {
        ZStack(alignment: alignment) {
            if isLoading {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                    .fill(.customGray6)
                    .frame(width: 62, height: buttonHeight)
                    .transition(.opacity.combined(with: .opacity))
                    .shimmering()
                    .frame(width: buttonWidth, alignment: alignment)
                    .environment(\.colorScheme, .light)
            } else {
                Button(action: {
                    HapticFeedback.shared.trigger(style: .light)
                    action()
                }) {
                    Text(text)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(height: buttonHeight)
                        .background {
                            RoundedRectangle(cornerRadius: cornerRadius)
                                .fill(.ultraThinMaterial)
                                .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                        }
                }
                .frame(width: buttonWidth, alignment: alignment)
                .transition(.opacity.combined(with: .opacity))
            }
        }
        .frame(width: buttonWidth, height: buttonHeight, alignment: alignment)
        .animation(.easeInOut(duration: 0.5), value: isLoading)
    }
}
