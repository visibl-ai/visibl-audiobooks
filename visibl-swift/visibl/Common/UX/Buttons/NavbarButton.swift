//
//  NavbarButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct NavbarButton: View {
    let icon: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            if #available(iOS 26.0, *) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(.customBlack)
                    .frame(width: 44, height: 44)
                    .glassEffect(in: .circle)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(.customBlack)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: .circle)
            }
        }
    }
}
