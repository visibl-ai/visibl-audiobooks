//
//  PlayerSliderButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Shimmer

struct PlayerSliderButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        if isLoading {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                .fill(.customGray6)
                .frame(width: 36, height: 36)
                .transition(.opacity.combined(with: .opacity))
                .shimmering()
                .frame(width: 80, alignment: .trailing)
                .environment(\.colorScheme, .light)
        } else {
            Button(action: action) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.ultraThinMaterial)
                            .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                    }
                    .frame(width: 80, alignment: .trailing)
            }
            .transition(.opacity.combined(with: .opacity))
            .trackButtonTap("Playback Slider")
        }
    }
}
