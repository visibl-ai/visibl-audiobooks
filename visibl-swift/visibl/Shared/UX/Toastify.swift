//
//  Toastify.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import SwiftUI

enum ToastStyle {
    case error
    case warning
    case success
    case info
}

extension ToastStyle {
    var themeColor: Color {
        switch self {
        case .error: return Color(.toastRed)
        case .warning: return Color(.toastYellow)
        case .info: return Color(.toastBlue)
        case .success: return Color(.toastGreen)
        }
    }
    
    var iconFileName: String {
        switch self {
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .success: return "checkmark.circle.fill"
        case .error: return "xmark.circle.fill"
        }
    }
}

final class Toastify {
    private static var toast: UIView?
    private static var timer: Timer?
    private static var isAnimating: Bool = false
    
    static func show(style: ToastStyle, message: String) {
        if isAnimating {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { show(style: style, message: message) }
            return
        }
        
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else { return }
        
        timer?.invalidate()
        timer = nil
        
        if let existingToast = toast {
            isAnimating = true
            UIView.animate(withDuration: 0.3, animations: {
                existingToast.alpha = 0
                existingToast.transform = CGAffineTransform(translationX: 0, y: -200)
            }) { _ in
                existingToast.removeFromSuperview()
                self.toast = nil
                self.isAnimating = false
                show(style: style, message: message)
            }
            return
        }
        
        let toastView = ToastifyView(
            style: style,
            text: message
        ) {
            hide()
        }
        
        let hostingController = UIHostingController(rootView: toastView)
        hostingController.view.backgroundColor = .clear
        
        toast = hostingController.view
        guard let toast = toast else { return }
        
        toast.alpha = 0
        toast.transform = CGAffineTransform(translationX: 0, y: -200)
        
        window.addSubview(toast)
        toast.translatesAutoresizingMaskIntoConstraints = false
        
        NSLayoutConstraint.activate([
            toast.topAnchor.constraint(equalTo: window.topAnchor),
            toast.leadingAnchor.constraint(equalTo: window.leadingAnchor),
            toast.trailingAnchor.constraint(equalTo: window.trailingAnchor)
        ])
        
        window.layoutIfNeeded()
        
        isAnimating = true
        UIView.animate(withDuration: 0.3, animations: {
            toast.alpha = 1
            toast.transform = .identity
        }) { _ in
            isAnimating = false
            
            timer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { _ in
                hide()
            }
            
            RunLoop.main.add(timer!, forMode: .common)
        }
    }
    
    static func hide() {
        guard let toast = toast, !isAnimating else { return }
        
        timer?.invalidate()
        timer = nil
        
        isAnimating = true
        UIView.animate(withDuration: 0.3, animations: {
            toast.alpha = 0
            toast.transform = CGAffineTransform(translationX: 0, y: -200)
        }) { _ in
            toast.removeFromSuperview()
            self.toast = nil
            self.isAnimating = false
        }
    }
}

struct ToastifyView: View {
    let style: ToastStyle
    let text: String
    var action: () -> Void
    
    var body: some View {
        infoBox
    }
    
    private var infoBox: some View {
        HStack (alignment: .top, spacing: 12) {
            Image(systemName: style.iconFileName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.customBlack)
            Text(text)
                .font(.system(size: 16, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(.customBlack)
        }
        .padding(16)
        .background(.thinMaterial)
        .background(style.themeColor.opacity(0.33))
        .cornerRadius(12)
        .padding(.horizontal, 14)
        .onTapGesture(perform: action)
        .gesture(DragGesture(minimumDistance: 20, coordinateSpace: .global)
            .onEnded { value in
                let verticalAmount = value.translation.height
                
                if verticalAmount < 0 {
                    print("up swipe")
                    action()
                }
            }
        )
        .transition(.slide)
    }
}
