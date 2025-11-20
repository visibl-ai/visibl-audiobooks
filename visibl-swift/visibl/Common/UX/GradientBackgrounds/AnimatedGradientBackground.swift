//
//  AnimatedGradientBackground.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Combine

private enum AnimationProperties {
    static let animationSpeed: Double = 2
    static let timerDuration: TimeInterval = 3
    static let blurRadius: CGFloat = 130
}

struct AnimatedGradientBackground: View {
    @StateObject private var animator = CircleAnimator(colors: GradientColors.all)
        
    var body: some View {
        ZStack {
            ZStack {
                ForEach(animator.circles.indices, id: \.self) { index in
                    MovingCircle(originOffset: animator.circles[index].position)
                        .foregroundStyle(animator.circles[index].color)
                }
            }
            .blur(radius: AnimationProperties.blurRadius)
            
            titleText
                .foregroundStyle(.white)
                .blendMode(.difference)
                .overlay(titleText.blendMode(.hue))
                .overlay(titleText.foregroundStyle(.gray).blendMode(.overlay))
        }
        .background(GradientColors.background)
        .onAppear {
            animator.startAnimating()
        }
        .onDisappear {
            animator.stopAnimating()
        }
    }
    
    private var titleText: some View {
        Text("Hello World!")
            .font(.largeTitle)
            .bold()
    }
}

private enum GradientColors {
    static let all: [Color] = [
        Color(hex: "010010"),
        Color(hex: "22125A"),
        Color(hex: "8663E3"),
        Color(hex: "B9A9E4"),
        Color(hex: "B5A5E3")
    ]
    
    static var background: Color {
        Color(hex: "#010314")
    }
}

private struct MovingCircle: Shape {
    var originOffset: CGPoint
    var animatableData: CGPoint.AnimatableData {
        get {
            originOffset.animatableData
        }
        
        set {
            originOffset.animatableData = newValue
        }
    }
    
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let adjustedX = rect.width * originOffset.x
        let adjustedY = rect.height * originOffset.y
        let smallestDimension = min(rect.width, rect.height)
        
        path.addArc(
            center: CGPoint(x: adjustedX, y: adjustedY),
            radius: smallestDimension / 2,
            startAngle: .zero,
            endAngle: .degrees(360),
            clockwise: true
        )
        
        return path
    }
}

private class CircleAnimator: ObservableObject {
    
    struct Circle: Identifiable {
        let id = UUID()
        var position: CGPoint
        let color: Color
    }
    
    @Published var circles: [Circle] = []
    private var timer: Timer?
    
    init(colors: [Color]) {
        circles = colors.map { color in
            Circle(position: CircleAnimator.generateRandomPosition(), color: color)
        }
    }
    
    func startAnimating() {
        animate()
        
        timer = Timer.scheduledTimer(withTimeInterval: AnimationProperties.timerDuration, repeats: true) { _ in
            self.animate()
        }
    }
    
    func stopAnimating() {
        timer?.invalidate()
        timer = nil
    }
    
    private func animate() {
        withAnimation(.easeInOut(duration: AnimationProperties.animationSpeed)) {
            for index in circles.indices {
                circles[index].position = CircleAnimator.generateRandomPosition()
            }
        }
    }
    
    static func generateRandomPosition() -> CGPoint {
        CGPoint(x: CGFloat.random(in: 0...1), y: CGFloat.random(in: 0...1))
    }
}
