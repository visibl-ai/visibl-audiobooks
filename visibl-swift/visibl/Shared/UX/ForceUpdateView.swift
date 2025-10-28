//
//  ForceUpdateOverlayView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import UIKit

class ForceUpdateOverlayView {
    private static var updateWindow: UIWindow?
    
    static func show(appStoreURL: String) {
        hide()
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.windowLevel = .alert + 1
        let updateView = ForceUpdateView(appStoreURL: appStoreURL)
        let hostingController = UIHostingController(rootView: updateView)
        hostingController.view.backgroundColor = .clear
        window.rootViewController = hostingController
        window.makeKeyAndVisible()
        updateWindow = window
    }
    
    static func hide(completion: (() -> Void)? = nil) {
        guard let window = updateWindow else {
            completion?()
            return
        }
        
        UIView.animate(withDuration: 0.3, animations: {
            window.alpha = 0
        }) { _ in
            window.isHidden = true
            updateWindow = nil
            completion?()
        }
    }
}

struct ForceUpdateView: View {
    let appStoreURL: String
    
    var body: some View {
        ZStack {
            // Blurred background
            Color.black.opacity(0.64)
                .ignoresSafeArea()
                .blur(radius: 2)
            
            // Alert card
            VStack(spacing: 20) {
                // Icon
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.customIndigo)
                
                // Title
                Text("force_update_modal_title".localized)
                    .font(.title2)
                    .fontWeight(.bold)
                
                // Message
                Text("force_update_modal_message".localized)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
                
                // Update button
                Button(action: {
                    openAppStore()
                }) {
                    HStack {
                        Text("force_update_modal_button_title".localized)
                            .fontWeight(.semibold)
                        Image(systemName: "arrow.right")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.customIndigo.gradient)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .padding(.horizontal)
            }
            .padding(30)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(UIColor.systemBackground))
                    .shadow(color: .black.opacity(0.2), radius: 20, x: 0, y: 10)
            )
            .padding(40)
        }
    }
    
    private func openAppStore() {
        if let url = URL(string: appStoreURL) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Preview

#Preview {
    ForceUpdateView(appStoreURL: "itms-apps://itunes.apple.com/app/id123456789")
}
