//
//  IconSignInButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct IconSignInButton: View {
    let logo: String
    let backgroundColor: Color
    let textColor: Color
    let applyShadow: Bool
    let action: () -> Void
    
    init(
        logo: String,
        backgroundColor: Color = Color(.systemGray5),
        textColor: Color = Color(.label),
        applyShadow: Bool = false,
        action: @escaping () -> Void
    ) {
        self.logo = logo
        self.backgroundColor = backgroundColor
        self.textColor = textColor
        self.applyShadow = applyShadow
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(logo)
                .resizable()
                .frame(width: 20, height: 20)
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(width: 84, height: 50)
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
