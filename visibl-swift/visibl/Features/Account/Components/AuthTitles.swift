//
//  AuthTitles.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AuthTitles: View {
    let title: String
    let subtitle: String
    
    var body: some View {
        VStack (spacing: 8) {
            makeTitle(text: title)
            makeSubtitle(text: subtitle)
        }
    }
    
    private func makeTitle(text: String) -> some View {
        Text(text)
            .font(.system(size: 24, weight: .bold, design: .serif))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private func makeSubtitle(text: String) -> some View {
        Text(text)
            .font(.system(size: 16, weight: .regular))
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
