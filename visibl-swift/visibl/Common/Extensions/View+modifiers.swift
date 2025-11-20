//
//  View+modifiers.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

// MARK: - Modifier to get view height for sheet height adjustment

struct GetHeightModifier: ViewModifier {
    @Binding var height: CGFloat
    
    func body(content: Content) -> some View {
        content.background(
            GeometryReader { geo -> Color in
                DispatchQueue.main.async {
                    height = geo.size.height
                }
                return Color(UIColor.systemBackground)
            }
        )
    }
}

// MARK: - Shimmer effect for skeleton view

struct ShimmerEffect: ViewModifier {
    private let gradientColors = [
        Color(uiColor: UIColor.systemGray5),
        Color(uiColor: UIColor.systemGray6),
        Color(uiColor: UIColor.systemGray5)
    ]
    
    @State private var startPoint: UnitPoint = .init(x: -1.8, y: -1.2)
    @State private var endPoint: UnitPoint = .init(x: 0, y: -0.2)
    
    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geometry in
                    LinearGradient(
                        colors: gradientColors,
                        startPoint: startPoint,
                        endPoint: endPoint
                    )
                    .mask(content)
                }
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1)
                    .repeatForever(autoreverses: false)) {
                        startPoint = .init(x: 1, y: 1)
                        endPoint = .init(x: 2.2, y: 2.2)
                    }
            }
    }
}

extension View {
    func shimmerEffect() -> some View {
        modifier(ShimmerEffect())
    }
}
