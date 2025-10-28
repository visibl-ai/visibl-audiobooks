//
//  CataloguePlaceholder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct CataloguePlaceholder: View {
    let icon: String
    let title: String
    let subtitle: String
    
    var body: some View {
        VStack (spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(.white)
                .frame(width: 100, height: 100)
                .background(.black.gradient, in: .circle)
            
            VStack (spacing: 8) {
                Text(title)
                    .font(.system(size: 20, weight: .bold, design: .serif))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                
                Text(subtitle)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
        }
        .padding(.horizontal, 32)
        .padding(.top, UIScreen.main.bounds.height * 0.14)
    }
}
