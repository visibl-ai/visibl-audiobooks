//
//  TextSignInButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct TextSignInButton: View {
    let icon: String?
    let iconType: IconType
    let title: String
    let backgroundColor: Color
    let textColor: Color
    let applyShadow: Bool
    let action: () -> Void
    
    enum IconType {
        case system
        case custom
    }
    
    init(
        logo: String? = nil,
        iconType: IconType = .custom,
        title: String,
        backgroundColor: Color = Color(.systemGray5),
        textColor: Color = Color(.label),
        applyShadow: Bool = false,
        action: @escaping () -> Void
    ) {
        self.icon = logo
        self.iconType = iconType
        self.title = title
        self.backgroundColor = backgroundColor
        self.textColor = textColor
        self.applyShadow = applyShadow
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    if iconType == .custom {
                        Image(icon)
                            .resizable()
                            .frame(width: 20, height: 20)
                            .foregroundStyle(.black)
                    } else {
                        Image(systemName: icon)
                            .frame(width: 20, height: 20)
                            .foregroundStyle(.customBlack)
                    }
                }

                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(textColor)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background {
                if applyShadow {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(backgroundColor)
                        .shadow(color: .black.opacity(0.25), radius: 3, x: 0, y: 2)
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(backgroundColor)
                }
            }
        }
    }
}
