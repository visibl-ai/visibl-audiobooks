//
//  MainActionButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct MainActionButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .medium)
            action()
        }) {
            if #available(iOS 26.0, *) {
                Image("grid_icon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 40, height: 40)
                    .frame(width: 48, height: 48)
                    .background(.customIndigo.gradient, in: .circle)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .padding(.horizontal, 8)
            } else {
                Image("grid_icon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 40, height: 40)
                    .frame(width: 48, height: 48)
                    .background(.customIndigo.gradient, in: .circle)
                    .padding(.horizontal, 8)
            }
        }
    }
}
