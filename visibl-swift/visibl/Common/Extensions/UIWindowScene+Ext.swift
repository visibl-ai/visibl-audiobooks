//
//  UIWindowScene+Ext.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

extension UIWindowScene {
    static func topMostViewController() -> UIViewController? {
        guard let windowScene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              let window = windowScene.windows.first(where: { $0.isKeyWindow }) else {
            return nil
        }
        
        guard var topViewController = window.rootViewController else {
            return nil
        }
        
        while let presentedViewController = topViewController.presentedViewController {
            topViewController = presentedViewController
        }
        
        return topViewController
    }
}
