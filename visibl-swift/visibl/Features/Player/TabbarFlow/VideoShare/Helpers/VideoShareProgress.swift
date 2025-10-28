//
//  VideoShareProgress.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

@MainActor
final class VideoShareProgress: ObservableObject {
    @Published var progress: Double = 0.0
    @Published var message: String = "Preparing..."
    @Published var isShowing: Bool = false
    @Published var isCancelled: Bool = false

    var onCancel: (() -> Void)?

    func show() {
        isShowing = true
        progress = 0.0
        message = "Preparing..."
        isCancelled = false
    }

    func hide() {
        isShowing = false
        reset()
    }

    func update(progress: Double, message: String) {
        guard !isCancelled else { return }
        self.progress = min(max(progress, 0.0), 1.0)  // Clamp between 0-1
        self.message = message
    }

    func cancel() {
        isCancelled = true
        message = "Cancelling..."
        onCancel?()  // Call the cancel callback
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000) // 0.3s delay for UI feedback
            hide()
        }
    }

    private func reset() {
        progress = 0.0
        message = "Preparing..."
        isCancelled = false
    }
}