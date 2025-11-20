//
//  DoneButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct DoneButton: View {
    var action: () -> Void
    
    var body: some View {
        Button("done_button".localized) {
            action()
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(.customIndigo)
    }
}
