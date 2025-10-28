//
//  SettingsView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SettingsView: View {
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    @StateObject private var viewModel: SettingsViewModel
    @ObservedObject var userConfig = UserConfigurations.shared
    
    @State private var presentDisconnectConfirmAlert: Bool = false
    @State private var presetSignInRequestAlert: Bool = false
    
    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        _viewModel = StateObject(wrappedValue: SettingsViewModel())
    }
    
    var body: some View {
        mainView
            .trackScreenView("Settings")
            .navigationBarTitle("settings_title".localized)
            .safeAreaInset(edge: .bottom) {
                NowPlayingView(coordinator: coordinator, diContainer: diContainer)
            }
    }
    
    private var mainView: some View {
        VStack {
            ScrollView {
                ProfileSection() {
                    HapticFeedback.shared.trigger(style: .light)
                    coordinator.presentSheet(.signIn)
                }
                
                AAXProfileSection(
                    coordinator: coordinator,
                    authService: diContainer.authService,
                    aaxClient: diContainer.aaxClient,
                    player: diContainer.player,
                    aaxPipeline: diContainer.aaxPipeline
                )
                
                appSettingsSection
                informationSection
                appVersionSection
            }
        }
    }
    
    // MARK: - App Settings
    
    private var appSettingsSection: some View {
        VStack(spacing: 12) {
            DefaultSettingsRow(
                systemIcon: "moonphase.first.quarter",
                title: "app_appearance".localized,
                selectedValue: userConfig.selectedAppearance.localizedName
            ) {
                HapticFeedback.shared.trigger(style: .light)
                coordinator.presentSheet(.appAppearance)
            }
            
            Divider().background(.gray.opacity(0.5))
            
            SettingsRowWithToggle(
                icon: "hand.tap.fill",
                title: "haptic_touch".localized,
                isEnabled: $userConfig.isHapticTouchEnabled
            )
            .onChange(of: userConfig.isHapticTouchEnabled) { oldValue, newValue in
                if newValue {
                    HapticFeedback.shared.trigger(style: .light)
                }
            }
            
            Divider().background(.gray.opacity(0.5))
            
            SettingsRowWithToggle(
                icon: "photo.stack.fill",
                title: "lock_screen_carousel".localized,
                isEnabled: $userConfig.displayCarouselOnHomeScreen
            )
            .onChange(of: userConfig.displayCarouselOnHomeScreen) { oldValue, newValue in
                if newValue {
                    batteryDrainAlert()
                    print("Home Carousel enabled")
                } else {
                    print("Home Carousel disabled")
                }
            }
        }
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 20)
        .padding(.top, 6)
    }
    
    // MARK: - Information
    
    private var informationSection: some View {
        VStack(spacing: 12) {
            DefaultSettingsRow(
                systemIcon: "hand.thumbsup.fill",
                title: "rate_app".localized
            ) {
                HapticFeedback.shared.trigger(style: .light)
                UIApplication.shared.open(URL(string: Constants.rateAppURL)!)
            }
            
            Divider().background(.gray.opacity(0.5))
                        
            makeShareButton(
                icon: "square.and.arrow.up.fill",
                title: "share_with_friends".localized,
                link: URL(string: Constants.shareAppURL)!
            )
            
            Divider().background(.gray.opacity(0.5))
            
//            DefaultSettingsRow(
//                icon: "envelope.fill",
//                title: "contact_us".localized
//            ) {
//                HapticFeedback.shared.trigger(style: .light)
//                coordinator.presentSheet(.sendMail(""))
//            }
            
            DefaultSettingsRow(
                customIcon: "discord_logo",
                title: "join_discord_title".localized,
                iconSize: 20
            ) {
                HapticFeedback.shared.trigger(style: .light)
                UIApplication.shared.open(URL(string: Constants.discordServerURL)!)
            }
        }
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 20)
        .padding(.top, 6)
    }
    
    // MARK: - Share Button
    
    private func makeShareButton(icon: String, title: String, link: URL) -> some View {
        ShareLink(item: link) {
            HStack (spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(.black)
                    .cornerRadius(6)
                
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                
                Image(systemName: "chevron.right")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 12, height: 12)
                    .foregroundColor(.gray)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
        }
    }
    
    // MARK: - App Version
    
    private var appVersionSection: some View {
        Text("app_version_title".localized + " " + userConfig.appVersion + ".\(userConfig.buildNumber)")
            .font(.system(size: 13, weight: .light))
            .foregroundColor(.gray)
            .padding(.top, 18)
            .padding(.bottom, 32)
            .onTapGesture {
                #if DEBUG
                viewModel.copyUserUIDToClipboard()
                #endif
            }
    }
}

extension SettingsView {    
    private func batteryDrainAlert() {
        AlertManager.shared.showAlert(
            alertTitle: "battery_drain_alert_title".localized,
            alertMessage: "battery_drain_alert_message".localized,
            alertButtons: [
                .cancel("battery_drain_alert_got_it_btn".localized) {}
            ]
        )
    }
}
