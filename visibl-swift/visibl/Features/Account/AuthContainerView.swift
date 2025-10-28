//
//  AuthContainerView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AuthContainerView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel: AuthViewModel
    @StateObject private var coordinator: AuthCoordinator
    @ObservedObject private var aaxPipeline: AAXPipeline
    private var audiobook: AudiobookModel?
    private let onSuccess: (() -> Void)?
    
    init(
        authService: AuthServiceProtocol,
        player: AudioPlayerManager,
        aaxPipeline: AAXPipeline,
        audiobook: AudiobookModel? = nil,
        onSuccess: (() -> Void)? = nil
    ) {
        self.audiobook = audiobook
        self.aaxPipeline = aaxPipeline
        _viewModel = StateObject(
            wrappedValue: AuthViewModel(
                authService: authService,
                player: player
            )
        )
        _coordinator = StateObject(wrappedValue: AuthCoordinator())
        self.onSuccess = onSuccess
    }
    
    var body: some View {
        makeUI
            .overlay {
                loadingOverlay
            }
    }
    
    @ViewBuilder
    private var makeUI: some View {
        switch viewModel.authState {
        case .auth:
            authFlowView
        case .passwordResetSuccess:
            PasswordResetSuccessView(
                viewModel: viewModel,
                coordinator: coordinator
            )
        case .profile:
            ProfileView(viewModel: viewModel, aaxPipeline: aaxPipeline)
        }
    }
    
    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.3).ignoresSafeArea()
            LoadifyView()
        }
        .opacity(viewModel.isLoading ? 1 : 0)
    }
    
    private var authFlowView: some View {
        NavigationStack(path: $coordinator.navigationPath) {
            AuthMainView(
                viewModel: viewModel,
                coordinator: coordinator,
                callDismiss: {
                    dismiss()
                },
                onSuccess: onSuccess
            )
            .navigationDestination(for: AuthDestination.self) { destination in
                destinationView(for: destination)
            }
            .navigationBarBackButtonHidden(true)
        }
    }
    
    @ViewBuilder
    private func destinationView(for destination: AuthDestination) -> some View {
        switch destination {
        case .navigateToSignIn:
            SignInWithEmailView(
                viewModel: viewModel,
                coordinator: coordinator,
                callDismiss: {
                    dismiss()
                },
                onSuccess: onSuccess
            )
            .navigationBarBackButtonHidden(true)
            .navigationBarItems(
                leading: BackButton {
                    coordinator.navigateBack()
                }
            )
        case .navigateToSignUp:
            SignUpWithEmailView(
                viewModel: viewModel,
                coordinator: coordinator,
                callDismiss: {
                    dismiss()
                },
                onSuccess: onSuccess
            )
            .navigationBarBackButtonHidden(true)
            .navigationBarItems(
                leading: BackButton {
                    coordinator.navigateBack()
                }
            )
        case .navigateToPasswordReset:
            RestorePasswordView(
                viewModel: viewModel,
                coordinator: coordinator
            )
            .navigationBarBackButtonHidden(true)
            .navigationBarItems(
                leading: BackButton {
                    coordinator.navigateBack()
                }
            )
        }
    }
}
