//
//  SceneProgressBar.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SceneProgressBar: View {
    let progress: Double
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(.gray)
                    .frame(height: 3)
                
                Rectangle()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: geometry.size.width * progress, height: 3)
            }
        }
        .frame(height: 3)
    }
}
