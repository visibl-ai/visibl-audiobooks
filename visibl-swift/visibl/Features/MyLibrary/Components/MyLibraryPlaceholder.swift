//
//  MyLibraryPlaceholder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct MyLibraryPlaceholder: View {
    let type: MyLibraryPlaceholderType
    
    let action: () -> Void
    
    var body: some View {
        VStack (spacing: 18) {
            Image(systemName: type.icon)
                .font(.system(size: 64))
                .foregroundStyle(
                    .customWhite,
                    LinearGradient(
                        colors: [.customBlack, .customBlack.opacity(0.7)],
                        startPoint: .bottomLeading,
                        endPoint: .topTrailing
                    )
                )
            
            VStack (spacing: 8) {
                Text(type.title)
                    .font(.system(size: 24, weight: .bold, design: .serif))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                
                Text(type.subtitle)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
            
            if !type.callToActionButtonTitle.isEmpty {
                Button(action: action) {
                    HStack (spacing: 10) {
                        Text(type.callToActionButtonTitle)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                        
                        Image(systemName: "chevron.right")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            colors: [
                                .customIndigo,
                                .customIndigo.opacity(0.7)
                            ],
                            startPoint: .bottomLeading, endPoint: .topTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                }
            }
        }
        .padding(.horizontal, 32)
    }
}
