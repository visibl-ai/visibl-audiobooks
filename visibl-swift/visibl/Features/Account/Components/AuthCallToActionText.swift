//
//  AuthCallToActionText.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AuthCallToActionText: View {
    let text: String
    let buttonText: String
    let action: () -> Void
    
    var body: some View {
        HStack {
            Text(text)
                .font(.system(size: 16, weight: .regular))
            
            Button(action: action) {
                Text(buttonText)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.customIndigo)
            }
        }
    }
}
