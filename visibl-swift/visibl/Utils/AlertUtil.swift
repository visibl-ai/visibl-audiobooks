//
//  AlertUtil.swift
//

import UIKit
import ObjectiveC

// MARK: - Associated Object Keys
private struct ValidationKey {
    static var validateInput: UInt8 = 0
    static var actions: UInt8 = 0
}

// MARK: - UIAlertController Extension
extension UIAlertController {
    @objc func textFieldDidChange(_ textField: UITextField) {
        guard let text = textField.text,
              let validateInput = objc_getAssociatedObject(self, &ValidationKey.validateInput) as? (String) -> Bool,
              let actions = objc_getAssociatedObject(self, &ValidationKey.actions) as? [UIAlertAction] else {
            return
        }
        
        let isValid = validateInput(text)
        
        // Enable/disable the stored actions based on validation
        actions.forEach { $0.isEnabled = isValid }
    }
}

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

// MARK: - Text Input Alert Button
enum TextAlertButton {
    case `default`(title: String, action: ((String) -> Void)?)
    case cancel(title: String, action: (() -> Void)?)
    case destructive(title: String, action: ((String) -> Void)?)
    
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

extension TextAlertButton {
    static func `default`(_ title: String, action: ((String) -> Void)? = nil) -> TextAlertButton {
        .default(title: title, action: action)
    }
    
    static func cancel(_ title: String, action: (() -> Void)? = nil) -> TextAlertButton {
        .cancel(title: title, action: action)
    }
    
    static func destructive(_ title: String, action: ((String) -> Void)? = nil) -> TextAlertButton {
        .destructive(title: title, action: action)
    }
}

class AlertUtil {
    static let shared = AlertUtil()
    
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
    
    // MARK: - Text Input Alert
    func showTextInputAlert(
        alertTitle: String,
        alertMessage: String,
        placeholder: String = "",
        defaultText: String = "",
        alertButtons: [TextAlertButton],
        validateInput: ((String) -> Bool)? = nil
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
        
        // Add text field
        alertController.addTextField { textField in
            textField.placeholder = placeholder
            textField.text = defaultText
            textField.clearButtonMode = .whileEditing
        }
        
        // Add buttons
        var actionRefs: [UIAlertAction] = []
        
        for button in alertButtons {
            let action = UIAlertAction(title: button.title, style: button.style) { [weak alertController] _ in
                let textField = alertController?.textFields?.first
                let inputText = textField?.text ?? ""
                
                switch button {
                case .default(_, let action), .destructive(_, let action):
                    action?(inputText)
                case .cancel(_, let action):
                    action?()
                }
            }
            
            // Disable non-cancel buttons initially if validation is provided
            if case .cancel = button {
                // Cancel buttons are always enabled
            } else if let validateInput = validateInput {
                action.isEnabled = validateInput(defaultText)
                actionRefs.append(action)
            }
            
            alertController.addAction(action)
        }
        
        // Add real-time validation if provided
        if let validateInput = validateInput, !actionRefs.isEmpty {
            alertController.textFields?.first?.addTarget(
                alertController,
                action: #selector(UIAlertController.textFieldDidChange(_:)),
                for: .editingChanged
            )
            
            // Store validation info using objc_setAssociatedObject
            objc_setAssociatedObject(
                alertController,
                &ValidationKey.validateInput,
                validateInput,
                .OBJC_ASSOCIATION_COPY_NONATOMIC
            )
            
            objc_setAssociatedObject(
                alertController,
                &ValidationKey.actions,
                actionRefs,
                .OBJC_ASSOCIATION_RETAIN_NONATOMIC
            )
        }
        
        topVC.present(alertController, animated: true, completion: nil)
    }
}

// MARK: - Convenience Methods
extension AlertUtil {
    
    /// Show a simple text input alert with Create/Cancel buttons
    func showCreateAlert(
        title: String,
        message: String,
        placeholder: String,
        onCreate: @escaping (String) -> Void,
        onCancel: (() -> Void)? = nil
    ) {
        showTextInputAlert(
            alertTitle: title,
            alertMessage: message,
            placeholder: placeholder,
            alertButtons: [
                .cancel("Cancel", action: onCancel),
                .default("Create", action: onCreate)
            ],
            validateInput: { text in
                !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        )
    }
    
    /// Show a simple text input alert with Save/Cancel buttons
    func showEditAlert(
        title: String,
        message: String,
        placeholder: String,
        currentText: String = "",
        onSave: @escaping (String) -> Void,
        onCancel: (() -> Void)? = nil
    ) {
        showTextInputAlert(
            alertTitle: title,
            alertMessage: message,
            placeholder: placeholder,
            defaultText: currentText,
            alertButtons: [
                .cancel("Cancel", action: onCancel),
                .default("Save", action: onSave)
            ],
            validateInput: { text in
                !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        )
    }
}
