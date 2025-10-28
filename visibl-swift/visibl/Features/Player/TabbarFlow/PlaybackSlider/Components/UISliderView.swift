//
//  UISliderView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct UISliderView: UIViewRepresentable {
    // Value binding
    @Binding var value: Double
    
    // Range & callbacks
    var minValue = 0.0
    var maxValue = 1.0
    var onEditingChanged: ((Bool) -> Void)?
    
    // Styling
    var thumbColor: UIColor = .white
    var minTrackColor: UIColor = .customIndigo
    var maxTrackColor: UIColor = .lightGray
    
    // MARK: Coordinator
    
    final class Coordinator: NSObject {
        var parent: UISliderView
        
        // Interaction state
        var isUserInteracting = false
        var lastUserValue: Float?
        
        // External updates throttling
        var ignoreExternalUpdates = false
        var ignoreTimer: Timer?
        
        init(_ parent: UISliderView) {
            self.parent = parent
        }
        
        // MARK: Events
        
        @objc func valueChanged(_ sender: UISlider) {
            guard isUserInteracting else { return }
            
            lastUserValue = sender.value
            parent.value = Double(sender.value)
            
            // Ignore external updates briefly after user interaction
            ignoreExternalUpdates = true
            ignoreTimer?.invalidate()
            ignoreTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
                self?.ignoreExternalUpdates = false
            }
        }
        
        @objc func editingDidBegin(_ sender: UISlider) {
            isUserInteracting = true
            ignoreExternalUpdates = true
            lastUserValue = sender.value
            parent.onEditingChanged?(true)
            
            // Cancel any pending timer
            ignoreTimer?.invalidate()
        }
        
        @objc func editingDidEnd(_ sender: UISlider) {
            // Final value commit
            lastUserValue = sender.value
            parent.value = Double(sender.value)
            
            // Keep ignoring external updates briefly after release
            ignoreTimer?.invalidate()
            ignoreTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
                self?.ignoreExternalUpdates = false
                self?.lastUserValue = nil
            }
            
            isUserInteracting = false
            parent.onEditingChanged?(false)
        }
    }
    
    // MARK: UIViewRepresentable
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    func makeUIView(context: Context) -> UISlider {
        let slider = UISlider(frame: .zero)
        slider.minimumValue = Float(minValue)
        slider.maximumValue = Float(maxValue)
        slider.value = Float(value)
        slider.isContinuous = true
        
        // Colors
        slider.thumbTintColor = thumbColor
        slider.minimumTrackTintColor = minTrackColor
        slider.maximumTrackTintColor = maxTrackColor
        
        // Events
        slider.addTarget(context.coordinator, action: #selector(Coordinator.editingDidBegin(_:)), for: .touchDown)
        slider.addTarget(context.coordinator, action: #selector(Coordinator.valueChanged(_:)), for: .valueChanged)
        slider.addTarget(
            context.coordinator,
            action: #selector(Coordinator.editingDidEnd(_:)),
            for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        
        return slider
    }
    
    func updateUIView(_ uiView: UISlider, context: Context) {
        // Update appearance properties if changed
        if uiView.minimumValue != Float(minValue) {
            uiView.minimumValue = Float(minValue)
        }
        if uiView.maximumValue != Float(maxValue) {
            uiView.maximumValue = Float(maxValue)
        }
        if uiView.thumbTintColor != thumbColor {
            uiView.thumbTintColor = thumbColor
        }
        if uiView.minimumTrackTintColor != minTrackColor {
            uiView.minimumTrackTintColor = minTrackColor
        }
        if uiView.maximumTrackTintColor != maxTrackColor {
            uiView.maximumTrackTintColor = maxTrackColor
        }
        
        // Skip value updates during user interaction or shortly after
        if context.coordinator.isUserInteracting || context.coordinator.ignoreExternalUpdates {
            return
        }
        
        // Apply external value updates
        let targetValue = Float(value)
        let clampedValue = min(max(targetValue, uiView.minimumValue), uiView.maximumValue)
        
        // Only update if there's a meaningful difference
        if abs(uiView.value - clampedValue) > 0.001 {
            // Avoid stale updates conflicting with recent user input
            if let lastUserValue = context.coordinator.lastUserValue,
               abs(lastUserValue - clampedValue) > 0.01 {
                return
            }
            
            UIView.performWithoutAnimation {
                uiView.setValue(clampedValue, animated: false)
            }
        }
    }
}

// MARK: - SwiftUI Slider API Compatibility

extension UISliderView {
    /// Matches `Slider(value:in:onEditingChanged:)`
    init(
        value: Binding<Double>,
        in bounds: ClosedRange<Double> = 0 ... 1,
        onEditingChanged: @escaping (Bool) -> Void = { _ in }
    ) {
        self._value = value
        self.minValue = bounds.lowerBound
        self.maxValue = bounds.upperBound
        self.onEditingChanged = onEditingChanged
    }
    
    /// Matches `Slider(value:in:step:onEditingChanged:)` for floating-point generics
    init<V: BinaryFloatingPoint>(
        value: Binding<V>,
        in bounds: ClosedRange<V> = 0 ... 1,
        step: V.Stride = 1,
        onEditingChanged: @escaping (Bool) -> Void = { _ in }
    ) where V.Stride: BinaryFloatingPoint {
        self._value = Binding<Double>(
            get: { Double(value.wrappedValue) },
            set: { value.wrappedValue = V($0) }
        )
        self.minValue = Double(bounds.lowerBound)
        self.maxValue = Double(bounds.upperBound)
        self.onEditingChanged = onEditingChanged
        _ = step // keep signature parity
    }
}

// MARK: - Custom Modifiers

extension UISliderView {
    @discardableResult
    func sliderColors(
        thumb: UIColor? = nil,
        minTrack: UIColor? = nil,
        maxTrack: UIColor? = nil
    ) -> UISliderView {
        var view = self
        if let thumb { view.thumbColor = thumb }
        if let minTrack { view.minTrackColor = minTrack }
        if let maxTrack { view.maxTrackColor = maxTrack }
        return view
    }
}
