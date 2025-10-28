//
//  PlayerStyleNameView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Shimmer

struct PlayerStyleNameView: View {
    let isLoading: Bool
    let styleName: String?
    let onStyleTap: () -> Void

    var body: some View {
        if isLoading {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                .fill(.customGray6)
                .frame(width: 80, height: 32)
                .transition(.opacity.combined(with: .opacity))
                .shimmering()
                .environment(\.colorScheme, .light)
        } else {
            if let styleName = styleName {
                Text(styleName)
                    .font(.system(size: 15, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.ultraThinMaterial)
                            .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
                    }
                    .transition(.opacity.combined(with: .opacity))
                    .onTapGesture(perform: onStyleTap)
            } else {
                Text("book_info_no_styles_title".localized)
                    .font(.system(size: 15, weight: .regular, design: .monospaced))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(.ultraThinMaterial, in: .rect(cornerRadius: 6))
                    .transition(.opacity.combined(with: .opacity))
            }
        }
    }
}
