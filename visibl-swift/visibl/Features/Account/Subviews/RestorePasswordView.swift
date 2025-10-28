//
//  RestorePasswordView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct RestorePasswordView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @ObservedObject private var coordinator: AuthCoordinator
    @State private var email = ""
    
    init(viewModel: AuthViewModel, coordinator: AuthCoordinator) {
        self.viewModel = viewModel
        self.coordinator = coordinator
    }
    
    var body: some View {
        makeUI
            .trackScreenView("Password Reset")
    }
    
    private var makeUI: some View {
        VStack (spacing: 16) {
            Spacer()
            titles
            EmailTextField(email: $email)
            continueButton
            Spacer()
        }
        .padding(.horizontal, 32)
    }
    
    private var titles: some View {
        AuthTitles(
            title: "reset_password_title".localized,
            subtitle: "reset_password_subtitle".localized
        )
    }
    
    private var continueButton: some View {
        AuthActionButton(
            title: "reset_password_button".localized
        ) {
            Task { await viewModel.resetPassword(email: email) }
        }
    }
}
