//
//  PlayerNavbarTitle.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerNavbarTitle: View {
    let text: String
    let action: () -> Void
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .light)
            action()
        }) {
            Text(text)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .frame(height: 36, alignment: .center)
        }
    }
}
