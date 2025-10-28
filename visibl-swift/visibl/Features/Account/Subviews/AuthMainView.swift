//
//  AuthMainView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AuthMainView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @ObservedObject private var coordinator: AuthCoordinator
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
            .trackScreenView("Authentication")
    }
    
    private var makeUI: some View {
        VStack (spacing: 24) {
            Spacer()
            titles
            buttons
            rulesAcceptText
            Spacer()
        }
        .navigationBarBackButtonHidden(true)
        .navigationBarTitle("", displayMode: .inline)
        .padding(.horizontal, 32)
    }
    
    private var titles: some View {
        AuthTitles(
            title: "auth_main_view_title".localized,
            subtitle: "auth_main_view_subtitle".localized
        )
    }
    
    private var buttons: some View {
        VStack (spacing: 16) {
            VStack (spacing: 10) {
                Text("enter_your_email_title".localized)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.gray)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                EmailTextField(email: $viewModel.email)
            }
            
            AuthActionButton(
                title: "continue_btn".localized
            ) {
                Task {
                    if let userExists = await viewModel.doesUserExist() {
                        if userExists {
                            coordinator.navigateToSignIn()
                        } else {
                            coordinator.navigateToSignUp()
                        }
                    }
                }
            }
            
            divider
            
            TextSignInButton(
                logo: "apple_logo",
                title: "continue_with_apple_btn".localized,
                backgroundColor: .black,
                textColor: .white
            ) {
                viewModel.signInWithApple { success in
                    if success {
                        callDismiss()
                        if let onSuccessHandler = onSuccess {
                            onSuccessHandler()
                        }
                    }
                }
            }
            
            TextSignInButton(
                logo: "google_logo",
                title: "continue_with_google_btn".localized,
                backgroundColor: .white,
                textColor: .black,
                applyShadow: true
            ) {
                viewModel.signInWithGoogle { success in
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
    
    private var divider: some View {
        ZStack {
            Rectangle().fill(Color(.systemGray3)).frame(height: 1)
            Text("or_title".localized)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.gray)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(Color(.systemBackground))
        }
        .padding(.vertical, 5)
    }
    
    private var rulesAcceptText: some View {
        Text(
            .init(
                "consent_text".localizedFormat(
                    Constants.privatePolicyURL,
                    Constants.termsOfServiceURL
                )
            )
        )
        .tint(.customIndigo)
        .font(.system(size: 13, weight: .light))
        .foregroundStyle(.customBlack)
        .multilineTextAlignment(.center)
    }
}
