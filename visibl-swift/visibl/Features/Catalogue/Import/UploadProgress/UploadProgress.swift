//
//  UploadProgress.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import SwiftUI

final class UploadProgress: ObservableObject {
    static let shared = UploadProgress()

    @Published var progress: Double = 0.0
    @Published var message: String = "Preparing..."
    @Published var isCancelled: Bool = false

    var onCancel: (() -> Void)?
    private(set) var sessionId: UUID = UUID()

    private var overlayView: UIView?
    private var progressHUD: UIView?

    func show(message: String = "Uploading...") -> UUID {
        let newSessionId = UUID()
        DispatchQueue.main.async {
            self.hideOverlay()

            self.sessionId = newSessionId
            self.progress = 0.0
            self.message = message
            self.isCancelled = false

            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let window = windowScene.windows.first else { return }

            let progressView = UploadProgressView(progressState: self)
            let hostingController = UIHostingController(rootView: progressView)
            hostingController.view.backgroundColor = .clear

            self.progressHUD = hostingController.view

            guard let progressHUD = self.progressHUD else { return }

            let overlayView = UIView(frame: window.bounds)
            overlayView.backgroundColor = .clear
            self.overlayView = overlayView

            window.addSubview(overlayView)
            window.addSubview(progressHUD)

            progressHUD.translatesAutoresizingMaskIntoConstraints = false

            NSLayoutConstraint.activate([
                progressHUD.topAnchor.constraint(equalTo: window.topAnchor),
                progressHUD.bottomAnchor.constraint(equalTo: window.bottomAnchor),
                progressHUD.leadingAnchor.constraint(equalTo: window.leadingAnchor),
                progressHUD.trailingAnchor.constraint(equalTo: window.trailingAnchor)
            ])
        }
        return newSessionId
    }

    func hide() {
        DispatchQueue.main.async {
            self.hideOverlay()
            self.reset()
        }
    }

    private func hideOverlay() {
        overlayView?.removeFromSuperview()
        progressHUD?.removeFromSuperview()
        overlayView = nil
        progressHUD = nil
    }

    func update(progress: Double, for sessionId: UUID) {
        DispatchQueue.main.async {
            // Ignore updates from stale sessions
            guard sessionId == self.sessionId, !self.isCancelled else { return }
            self.progress = min(max(progress, 0.0), 1.0)
        }
    }

    func cancel() {
        DispatchQueue.main.async {
            self.isCancelled = true
            self.message = "Cancelling..."
            self.onCancel?()
            Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                await MainActor.run { self.hide() }
            }
        }
    }

    private func reset() {
        sessionId = UUID() // Invalidate any stale progress callbacks
        progress = 0.0
        message = "Preparing..."
        isCancelled = false
        onCancel = nil
    }
}
