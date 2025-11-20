//
//  MailComposeView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import MessageUI

struct MailComposeView: UIViewControllerRepresentable {
    let subject: String
    @Environment(\.dismiss) private var dismiss
    
    private func getDeviceInfo() -> String {
        let deviceModel = "\(UIDevice.current.model)"
        let systemVersion = UIDevice.current.systemVersion
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
        
        return """
        
        
        
        
        
        
        
        
        App Name: visibl
        Device Model: \(deviceModel)
        System Version: \(systemVersion)
        App Version: \(appVersion)
        
        """
    }
    
    static var canSendMail: Bool {
        MFMailComposeViewController.canSendMail()
    }
    
    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let controller = MFMailComposeViewController()
        controller.setSubject(subject)
        controller.setToRecipients([Constants.supportEmail])
        
        let emailBody = getDeviceInfo()
        controller.setMessageBody(emailBody, isHTML: false)
        
        controller.mailComposeDelegate = context.coordinator
        return controller
    }
    
    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) {
        // We don't update the MFMailComposeViewController
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(dismiss: dismiss)
    }
    
    class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        private var dismiss: DismissAction
        
        init(dismiss: DismissAction) {
            self.dismiss = dismiss
        }
        
        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) {
            dismiss()
        }
    }
}
