//
//  SignInWithEmailView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SignInWithEmailView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @ObservedObject private var coordinator: AuthCoordinator
    @State private var password = ""
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
            .trackScreenView("Sign in with email")
    }
    
    private var makeUI: some View {
        VStack (spacing: 16) {
            Spacer()
            titles
            PasswordTextField(
                password: $password,
                placeholder: "password".localized,
                isNewPassword: false
            )
            continueButton
            forgotYourPassword
            Spacer()
        }
        .padding(.horizontal, 32)
    }
    
    private var titles: some View {
        VStack (spacing: 8) {
            makeTitle(text: "enter_password_title".localized)
            makeSubtitle(email: viewModel.email)
        }
    }
    
    private func makeTitle(text: String) -> some View {
        Text(text)
            .font(.system(size: 24, weight: .bold, design: .serif))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private func makeSubtitle(email: String) -> some View {
        let prefix = "enter_password_prefix".localized
        
        return (Text(prefix)
            .font(.system(size: 14, weight: .regular))
                + Text(viewModel.email.forceCharWrapping)
            .font(.system(size: 14, weight: .semibold)))
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private var continueButton: some View {
        AuthActionButton(
            title: "login_title".localized
        ) {
            viewModel.signInWithEmailAndPassword(
                email: viewModel.email,
                password: password
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
    
    private var forgotYourPassword: some View {
        Button(action: {
            coordinator.navigateToPasswordReset()
        }) {
            Text("forgot_password_title".localized)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(.customIndigo)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
