//
//  PasswordResetSuccessView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PasswordResetSuccessView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @ObservedObject private var coordinator: AuthCoordinator
    
    init(viewModel: AuthViewModel, coordinator: AuthCoordinator) {
        self.viewModel = viewModel
        self.coordinator = coordinator
    }
    
    var body: some View {
        makeUI
            .trackScreenView("Password Reset Success")
    }
    
    private var makeUI: some View {
        VStack (spacing: 18) {
            checkmark
            titles
            continueButton
        }
        .padding(.horizontal, 24)
    }
    
    private var checkmark: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 64))
            .foregroundStyle(
                .customWhite,
                LinearGradient(
                    colors: [.customBlack, .customBlack.opacity(0.7)],
                    startPoint: .bottomLeading,
                    endPoint: .topTrailing
                )
            )
    }
    
    private var titles: some View {
        AuthTitles(
            title: "reset_password_success_title".localized,
            subtitle: "reset_password_success_subtitle".localized
        )
    }
    
    private var continueButton: some View {
        AuthActionButton(title: "continue_btn".localized) {
            coordinator.navigateToRoot()
            withAnimation(.easeInOut) { viewModel.authState = .auth }
        }
    }
}
