//
//  AuthBackButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AuthBackButton: View {
    let action: () -> Void
    
    var body: some View {
        Image(systemName: "chevron.left")
            .foregroundColor(.primary)
            .onTapGesture {
                action()
            }
    }
}
