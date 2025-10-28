//
//  ParallaxHeaderView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct ParallaxHeaderView<Content: View>: View {
    let content: Content
    let height: CGFloat
    let coverURL: URL?
    
    init(height: CGFloat, coverURL: URL?, @ViewBuilder content: () -> Content) {
        self.content = content()
        self.height = height
        self.coverURL = coverURL
    }
    
    var body: some View {
        GeometryReader { geometry in
            let offsetY = geometry.frame(in: .global).minY
            let isScrolled = offsetY > 0
            
            content
                .frame(height: isScrolled ? height + offsetY : height)
                .background {
                    KFImage(coverURL)
                        .resizable()
                        .scaledToFill()
                        .blur(radius: 30, opaque: true)
                        .clipped()
                        .overlay {
                            Color.black.opacity(0.25)
                        }
                }
                .offset(y: isScrolled ? -offsetY : 0)
                .scaleEffect(isScrolled ? offsetY / 2000 + 1 : 1)
        }
        .frame(height: height)
    }
}
