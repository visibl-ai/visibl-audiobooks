//
//  AAXProfileSection.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AAXProfileSection: View {
    private let coordinator: Coordinator
    private let authService: AuthServiceProtocol
    @ObservedObject private var aaxClient: AAXClientWrapper
    @ObservedObject private var player: AudioPlayerManager
    @ObservedObject private var aaxPipeline: AAXPipeline
    private var aaxProviderName: String {
        RemoteConfiguration.shared.aaxProvider?.name ?? "aax_profile_no_user_name_available".localized
    }
    
    init(
        coordinator: Coordinator,
        authService: AuthServiceProtocol,
        aaxClient: AAXClientWrapper,
        player: AudioPlayerManager,
        aaxPipeline: AAXPipeline
    ) {
        self.coordinator = coordinator
        self.authService = authService
        self.aaxClient = aaxClient
        self.player = player
        self.aaxPipeline = aaxPipeline
    }
    
    var body: some View {
        VStack(alignment: .leading) {
            HStack (spacing: 12) {
                Image(systemName: "link")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(.black)
                    .cornerRadius(6)
                
                if aaxClient.aaxAuthData == nil {
                    Text(String(format: "aax_profile_connect".localized, aaxProviderName))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.customBlack)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(1)
                    
                    Text("aax_profile_sign_in".localized)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(.customBlack)
                        .padding(.horizontal, 14)
                        .frame(height: 28)
                        .background(Color(.systemGray5))
                        .cornerRadius(8)
                    
                } else {
                    Text(aaxProviderName + " " + "aax_profile_connected".localized)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.customBlack)
                    
                    Spacer()
                    
                    HStack(spacing: 4) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.customBlack)
                        
                        Text(aaxClient.userName)
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(.customBlack)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(.customIndigo.opacity(0.25))
                    .cornerRadius(6)
                }
            }
            .padding(.horizontal, 12)
            .onTapGesture {
                connectAAX()
            }
            
            Divider().background(.gray.opacity(0.5))
            
            Text(String(format: "aax_profile_trademark_notice".localized, aaxProviderName, aaxProviderName))
                .font(.system(size: 13, weight: .light))
                .padding(.horizontal, 12)
                .padding(.top, 6)
        }
        .frame(height: 124)
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .padding(.horizontal, 20)
        .padding(.top, 6)
    }
    
    private func connectAAX() {
        HapticFeedback.shared.trigger(style: .light)
        
        guard authService.isUserSignedIn() else {
            signInRequiredAlert()
            return
        }

        guard aaxClient.currentClient != nil else {
            let onSuccessHandler = {
                coordinator.selectTab(.catalogue) { coordinator.selectedCatalogueSource = .aax }
            }
            coordinator.presentSheet(.aaxSignIn(onSuccess: onSuccessHandler))
            return
        }
        
        aaxSignOutConfirmationAlert()
    }
    
    private func disconnectAAX() {
        Task { @MainActor in
            Loadify.show()
            await aaxClient.disconnect()
            try SDDownloadManagerWrapper.shared.deleteAllFiles()
            player.stopAAX()
            Loadify.hide()
            aaxPipeline.cancelAllTasks()
        }
    }
}

extension AAXProfileSection {
    private func aaxSignOutConfirmationAlert() {
        AlertManager.shared.showAlert(
            alertTitle: String(format: "aax_disconnect_alert_title".localized, aaxProviderName),
            alertMessage: String(format: "aax_disconnect_alert_message".localized, aaxProviderName),
            alertButtons: [
                .destructive("aax_disconnect_alert_confirm_btn".localized) {
                    disconnectAAX()
                },
                .cancel("aax_disconnect_alert_cancel_btn".localized) {}
            ]
        )
    }
    
    private func signInRequiredAlert() {
        AlertManager.shared.showAlert(
            alertTitle: "sign_in_required_alert_title".localized,
            alertMessage: "sign_in_required_alert_message".localized,
            alertButtons: [
                .default("sign_in_required_alert_sign_in_btn".localized) {
                    coordinator.presentSheet(.signIn)
                },
                .cancel("sign_in_required_alert_cancel_btn".localized) {}
            ]
        )
    }
}
