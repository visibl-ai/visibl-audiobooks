//
//  SignUpWithEmailView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SignUpWithEmailView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @ObservedObject private var coordinator: AuthCoordinator
    @State private var password = ""
    @State private var confirmPassword = ""
    private let callDismiss: () -> Void
    private let onSuccess: (() -> Void)?
    
    init(
        viewModel: AuthViewModel,
        coordinator: AuthCoordinator,
        callDismiss: @escaping () -> Void,
        onSuccess: (() -> Void)? = nil
    ) {
        self.viewModel = viewModel
        self.coordinator = coordinator
        self.callDismiss = callDismiss
        self.onSuccess = onSuccess
    }
    
    var body: some View {
        makeUI
            .trackScreenView("Sign up with email")
    }
    
    private var makeUI: some View {
        VStack (spacing: 16) {
            Spacer()
            titles
            textFields
            continueButton
            Spacer()
        }
        .padding(.horizontal, 32)
    }
    
    private var titles: some View {
        VStack (spacing: 8) {
            makeTitle(text: "sign_up_title".localized)
            makeSubtitle(email: viewModel.email)
        }
    }
    
    private func makeTitle(text: String) -> some View {
        Text(text)
            .font(.system(size: 24, weight: .bold, design: .serif))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private func makeSubtitle(email: String) -> some View {
        let prefix = "sign_up_prefix".localized
        
        return (Text(prefix)
            .font(.system(size: 14, weight: .regular))
                + Text(viewModel.email.forceCharWrapping)
            .font(.system(size: 14, weight: .semibold)))
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private var textFields: some View {
        VStack (spacing: 12) {
            PasswordTextField(
                password: $password,
                placeholder: "password_placeholder".localized,
                isNewPassword: true
            )
            
            PasswordTextField(
                password: $confirmPassword,
                placeholder: "confirm_password_placeholder".localized,
                isNewPassword: true
            )
        }
    }
    
    private var continueButton: some View {
        AuthActionButton(
            title: "create_account_btn".localized
        ) {
            viewModel.signUpWithEmailAndPassword(
                email: viewModel.email,
                password: password,
                confirmPassword: confirmPassword
            ) { success in
                if success {
                    callDismiss()
                    if let onSuccessHandler = onSuccess {
                        onSuccessHandler()
                    }
                }
            }
        }
    }
}

extension String {
    /// Forces the string to apply the break by character mode.
    ///
    /// Text("This is a long text.".forceCharWrapping)
    var forceCharWrapping: Self {
        self.map({ String($0) }).joined(separator: "\u{200B}")
    }
}
