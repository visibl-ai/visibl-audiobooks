//
//  BackButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct BackButton: View {
    var action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack (spacing: 4) {
                Image(systemName: "chevron.left")
                    .foregroundStyle(.customIndigo)
                Text("back_button".localized)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.customIndigo)
            }
        }
    }
}
