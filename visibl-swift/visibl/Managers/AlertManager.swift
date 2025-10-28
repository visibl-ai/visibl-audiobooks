//
//  AlertManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

enum CustomAlertButton {
    case `default`(title: String, action: (() -> Void)?)
    case cancel(title: String, action: (() -> Void)?)
    case destructive(title: String, action: (() -> Void)?)
    
    var title: String {
        switch self {
        case .default(let title, _),
                .cancel(let title, _),
                .destructive(let title, _):
            return title
        }
    }
    
    var style: UIAlertAction.Style {
        switch self {
        case .default:
            return .default
        case .cancel:
            return .cancel
        case .destructive:
            return .destructive
        }
    }
    
    var action: (() -> Void)? {
        switch self {
        case .default(_, let action),
                .cancel(_, let action),
                .destructive(_, let action):
            return action
        }
    }
}

extension CustomAlertButton {
    static func `default`(_ title: String, action: (() -> Void)? = nil) -> CustomAlertButton {
        .default(title: title, action: action)
    }
    
    static func cancel(_ title: String, action: (() -> Void)? = nil) -> CustomAlertButton {
        .cancel(title: title, action: action)
    }
    
    static func destructive(_ title: String, action: (() -> Void)? = nil) -> CustomAlertButton {
        .destructive(title: title, action: action)
    }
}

class AlertManager {
    static let shared = AlertManager()
    
    private init() {}
    
    func showAlert(
        alertTitle: String,
        alertMessage: String,
        alertButtons: [CustomAlertButton]
    ) {
        
        guard let topVC = UIWindowScene.topMostViewController() else {
            print("No top view controller found to present the alert.")
            return
        }
        
        let alertController = UIAlertController(
            title: alertTitle,
            message: alertMessage,
            preferredStyle: .alert
        )
        
        for button in alertButtons {
            let action = UIAlertAction(title: button.title,
                                       style: button.style) { _ in
                button.action?()
            }
            alertController.addAction(action)
        }
        
        topVC.present(alertController, animated: true, completion: nil)
    }
}
