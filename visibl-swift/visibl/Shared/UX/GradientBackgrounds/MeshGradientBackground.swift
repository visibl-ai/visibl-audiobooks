//
//  MeshGradientBackground.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct MeshGradientBackground: View {
    @State private var isAnimating = false
    
    private let colors: [Color] = [
        Color(hex: "010010"),     // darkBlue
        Color(hex: "22125A"),     // darkPurple
        Color(hex: "8663E3"),     // brightPurple
        Color(hex: "B9A9E4"),     // lightPurple
        Color(hex: "B5A5E3"),     // lightPurpleAlt
        Color(hex: "010314")      // background
    ]
    
    var body: some View {
        MeshGradient(width: 3, height: 3, points: [
            [0.0, 0.0], [0.5, 0.0], [1.0, 0.0],
            [0.0, 0.5], [isAnimating ? 0.1 : 0.8, 0.5], [1.0, isAnimating ? 0.5 : 1],
            [0.0, 1.0], [0.5, 1.0], [1.0, 1.0]
        ], colors: [
            colors[0], colors[1], colors[0],
            isAnimating ? colors[3] : colors[2], colors[2], colors[4],
            colors[5], colors[1], colors[5]
        ])
        .edgesIgnoringSafeArea(.all)
        .onAppear() {
            withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
                isAnimating.toggle()
            }
        }
    }
}
