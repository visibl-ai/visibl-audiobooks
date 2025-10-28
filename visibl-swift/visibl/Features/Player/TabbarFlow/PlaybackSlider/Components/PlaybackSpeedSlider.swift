//
//  PlaybackSpeedSlider.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlaybackSpeedSlider: View {
    // MARK: Bindings
    @Binding var playbackSpeed: Double
    let onSpeedChange: (Double) -> Void
    
    // MARK: State
    @State private var isDragging: Bool = false
    @State private var dragPreviewSpeed: Double = 1.0
    @State private var isUserInteracting: Bool = false
    @State private var ignoreExternalUpdates: Bool = false
    @State private var ignoreTimer: Timer?
    
    // MARK: Constants
    /// Discrete speed options in 0.05 steps (0.5x ... 2.0x)
    private let speedOptions: [Double] = Array(stride(from: 0.5, through: 2.0, by: 0.05))
    private let minSpeed: Double = 0.5
    private let maxSpeed: Double = 2.0
    private let stepSize: Double = 0.05
    
    // MARK: Haptic Feedback
    private let impactFeedback = UIImpactFeedbackGenerator(style: .light)
    private let selectionFeedback = UISelectionFeedbackGenerator()
    
    // MARK: Body
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Track background
                
                if #available(iOS 26.0, *) {
                    Capsule()
                        .fill(.clear)
                        .glassEffect(in: .capsule)
                        .frame(height: 40)
                } else {
                    Capsule()
                        .fill(.ultraThinMaterial)
                        .frame(height: 40)
                }
                
                // Progress fill
                Capsule()
                    .fill(.customIndigo.gradient)
                    .frame(width: progressWidth(in: geometry.size.width), height: 40)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                // Speed labels
                HStack {
                    Text("0.5x")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                    
                    Spacer()
                    
                    Text("1.25x")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                    
                    Spacer()
                    
                    Text("2x")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 20)
                
                // Draggable thumb
                thumbView
                    .position(
                        x: thumbPosition(in: geometry.size.width),
                        y: geometry.size.height / 2
                    )
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                if !isDragging {
                                    isDragging = true
                                    isUserInteracting = true
                                    ignoreExternalUpdates = true
                                    dragPreviewSpeed = playbackSpeed  // Initialize preview with current speed
                                    
                                    // Light haptic when starting to drag
                                    impactFeedback.impactOccurred(intensity: 0.4)
                                    
                                    // Cancel any pending timer
                                    ignoreTimer?.invalidate()
                                }
                                updateSpeed(from: value.location.x, in: geometry.size.width)
                            }
                            .onEnded { _ in
                                isDragging = false
                                snapToNearestOption()
                                
                                // Keep ignoring external updates briefly after release
                                ignoreTimer?.invalidate()
                                ignoreTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [self] _ in
                                    ignoreExternalUpdates = false
                                }
                                
                                isUserInteracting = false
                                
                                // Medium haptic when releasing
                                impactFeedback.impactOccurred(intensity: 0.7)
                            }
                    )
            }
        }
        .frame(height: 40)
        .onTapGesture { location in
            isUserInteracting = true
            ignoreExternalUpdates = true
            
            // Light haptic on tap
            impactFeedback.impactOccurred(intensity: 0.5)
            
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                updateSpeedFromTap(at: location.x)
            }
            
            // Keep ignoring external updates briefly after tap
            ignoreTimer?.invalidate()
            ignoreTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [self] _ in
                ignoreExternalUpdates = false
            }
            
            isUserInteracting = false
        }
        .onAppear {
            // Prepare haptic generators for smoother feedback
            impactFeedback.prepare()
            selectionFeedback.prepare()
        }
    }
    
    // MARK: Subviews
    
    private var thumbView: some View {
        ZStack {
            // Shadow
            Capsule()
                .fill(.black.opacity(0.1))
                .frame(width: 90, height: 36)
                .blur(radius: 4)
                .offset(y: 2)
            
            // Background
            Capsule()
                .fill(.white)
                .frame(width: 90, height: 36)
                .overlay(
                    Capsule()
                        .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                )
            
            // Label
            Text(speedText)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.black)
        }
        .scaleEffect(isDragging ? 1.1 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isDragging)
        .onReceive(Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()) { _ in
            // Only update dragPreviewSpeed from external playbackSpeed changes when not interacting
            if !isUserInteracting && !ignoreExternalUpdates {
                let difference = abs(dragPreviewSpeed - playbackSpeed)
                if difference > 0.001 {
                    dragPreviewSpeed = playbackSpeed
                }
            }
        }
        .onAppear {
            dragPreviewSpeed = playbackSpeed
        }
    }
    
    // MARK: Computed
    
    private var currentDisplaySpeed: Double {
        return isUserInteracting || ignoreExternalUpdates ? dragPreviewSpeed : playbackSpeed
    }
    
    private var speedText: String {
        // Round to avoid floating-point precision artifacts
        let roundedSpeed = round(currentDisplaySpeed * 100) / 100
        
        if roundedSpeed == 1.0 {
            return "1x"
        } else if roundedSpeed.truncatingRemainder(dividingBy: 1) == 0 {
            return String(format: "%.0fx", roundedSpeed)
        } else {
            return String(format: "%.2fx", roundedSpeed)
        }
    }
    
    // MARK: Layout
    
    private func thumbPosition(in width: CGFloat) -> CGFloat {
        let padding: CGFloat = 45 // Half of thumb width
        let availableWidth = width - (padding * 2)
        let normalizedValue = (currentDisplaySpeed - minSpeed) / (maxSpeed - minSpeed)
        return padding + (availableWidth * normalizedValue)
    }
    
    private func progressWidth(in totalWidth: CGFloat) -> CGFloat {
        let normalizedValue = (currentDisplaySpeed - minSpeed) / (maxSpeed - minSpeed)
        return totalWidth * normalizedValue
    }
    
    // MARK: Updates
    
    private func updateSpeed(from xPosition: CGFloat, in width: CGFloat) {
        let padding: CGFloat = 45
        let availableWidth = width - (padding * 2)
        let clampedX = min(max(xPosition - padding, 0), availableWidth)
        let normalizedValue = clampedX / availableWidth
        
        let newSpeed = minSpeed + (normalizedValue * (maxSpeed - minSpeed))
        
        // Only update preview during drag, never the binding
        withAnimation(.interactiveSpring(response: 0.1, dampingFraction: 1)) {
            dragPreviewSpeed = newSpeed
        }
    }
    
    private func updateSpeedFromTap(at xPosition: CGFloat) {
        let padding: CGFloat = 45
        if let geometryWidth = UIScreen.main.bounds.width as CGFloat? {
            let availableWidth = geometryWidth - (padding * 2)
            let clampedX = min(max(xPosition - padding, 0), availableWidth)
            let normalizedValue = clampedX / availableWidth
            
            let tappedSpeed = minSpeed + (normalizedValue * (maxSpeed - minSpeed))
            
            // Nearest discrete option
            let nearestSpeed = speedOptions.min {
                abs($0 - tappedSpeed) < abs($1 - tappedSpeed)
            } ?? 1.0
            
            // Update preview first
            dragPreviewSpeed = nearestSpeed
            
            // Then update binding with small delay to prevent jumping
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [self] in
                playbackSpeed = nearestSpeed
                onSpeedChange(nearestSpeed)
            }
        }
    }
    
    private func snapToNearestOption() {
        // Round to nearest step and clamp to range
        let rounded = round(dragPreviewSpeed / stepSize) * stepSize
        let clampedSpeed = min(max(rounded, minSpeed), maxSpeed)
        
        // Update preview with animation
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            dragPreviewSpeed = clampedSpeed
        }
        
        // Only update the binding after a small delay to prevent jumping
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [self] in
            // Update binding and apply speed change
            playbackSpeed = clampedSpeed
            onSpeedChange(clampedSpeed)
        }
    }
}
