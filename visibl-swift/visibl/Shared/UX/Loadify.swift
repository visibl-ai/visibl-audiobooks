//
//  Loadify.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import SwiftUI

final class Loadify {
    private static var overlayView: UIView?
    private static var progressHUD: UIView?
    
    static func show() {
        hide()
        
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else { return }
        
        let loadingView = LoadifyView()
        
        let hostingController = UIHostingController(rootView: loadingView)
        hostingController.view.backgroundColor = .clear
        
        progressHUD = hostingController.view
        
        guard let progressHUD = progressHUD else { return }
        
        let overlayView = UIView(frame: window.bounds)
        overlayView.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        self.overlayView = overlayView
        
        window.addSubview(overlayView)
        window.addSubview(progressHUD)
        
        progressHUD.translatesAutoresizingMaskIntoConstraints = false
        
        NSLayoutConstraint.activate([
            progressHUD.centerXAnchor.constraint(equalTo: window.centerXAnchor),
            progressHUD.centerYAnchor.constraint(equalTo: window.centerYAnchor)
        ])
    }
    
    static func hide() {
        overlayView?.removeFromSuperview()
        progressHUD?.removeFromSuperview()
        overlayView = nil
        progressHUD = nil
    }
}

struct LoadifyView: View {
    var body: some View {
        VStack (spacing: 12) {
            ProgressView().scaleEffect(1.4)
            Text("loding_title".localized)
                .font(.system(size: 16, weight: .regular))
        }
        .padding(24)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gray.opacity(0.18), lineWidth: 1)
        )
        .shadow(radius: 5)
    }
}
