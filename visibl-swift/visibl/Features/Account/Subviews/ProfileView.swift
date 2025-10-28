//
//  ProfileView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import FirebaseAuth

struct ProfileView: View {
    @ObservedObject private var viewModel: AuthViewModel
    @State private var presentSignOutConfirmation = false
    @State private var presentDeleteAccountConfirmation = false
    @ObservedObject private var aaxPipeline: AAXPipeline
    @ObservedObject private var analytics: AnalyticsManager
    
    init(viewModel: AuthViewModel, aaxPipeline: AAXPipeline) {
        self.viewModel = viewModel
        self.aaxPipeline = aaxPipeline
        self.analytics = .shared
    }
    
    var body: some View {
        NavigationStack {
            makeUI
                .navigationBarTitle("account_title".localized, displayMode: .large)
                .alert(
                    "sign_out_alert_title".localized,
                    isPresented: $presentSignOutConfirmation
                ) {
                    Button("cancel_button".localized, role: .cancel) {
                        presentSignOutConfirmation = false
                    }
                    Button("sign_out_button".localized, role: .destructive) {
                        Task { await viewModel.signOut() }
                        aaxPipeline.cancelAllTasks()
                    }
                } message: {
                    Text("sign_out_alert_message".localized)
                }
                .alert(
                    "delete_account_alert_title".localized,
                    isPresented: $presentDeleteAccountConfirmation
                ) {
                    Button("cancel_button".localized, role: .cancel) {
                        presentDeleteAccountConfirmation = false
                    }
                    Button("delete_account_alert_btn".localized, role: .destructive) {
                        Task { await viewModel.deleteAccount() }
                        aaxPipeline.cancelAllTasks()
                    }
                } message: {
                    Text("delete_account_alert_message".localized)
                }
                .trackScreenView("Profile")
        }
    }
    
    private var makeUI: some View {
        VStack (spacing: 0) {
            profile
            information
            bottomButtons
            Spacer()
        }
        .background(.customBackground)
    }
    
    private var profile: some View {
        HStack (spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 38))
                .foregroundColor(.gray)
            
            VStack (spacing: 1) {
                Text(Auth.auth().currentUser?.displayName ?? "anonymous_user".localized)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                
                Text(Auth.auth().currentUser?.email ?? "user@example.com")
                    .font(.system(size: 13, weight: .regular))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }
    
    private var information: some View {
        VStack(spacing: 12) {
            DefaultSettingsRow(
                systemIcon: "lock.fill",
                title: "privacy_policy".localized
            ) {
                UIApplication.shared.open(URL(string: Constants.privatePolicyURL)!)
            }
            
            Divider().background(.gray.opacity(0.5))
            
            DefaultSettingsRow(
                systemIcon: "doc.plaintext.fill",
                title: "terms_of_use".localized
            ) {
                UIApplication.shared.open(URL(string: Constants.termsOfServiceURL)!)
            }
            
            Divider().background(.gray.opacity(0.5))
            
            SettingsRowWithToggle(
                icon: "chart.bar.fill",
                title: "Analytics Data Sharing",
                isEnabled: $analytics.isPosthogEnabled
            )
        }
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
    
    private var bottomButtons: some View {
        HStack (spacing: 12) {
            signOutButton
            deleteAccountButton
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
    }
    
    private var signOutButton: some View {
        Button(action: {
            presentSignOutConfirmation = true
        }) {
            Text("sign_out_button".localized)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .center)
                .lineLimit(1)
                .padding(12)
                .background(Color(.customButtonBG), in: RoundedRectangle(cornerRadius: 12))
        }
        .trackButtonTap("Sign Out")
    }
    
    private var deleteAccountButton: some View {
        Button(action: {
            presentDeleteAccountConfirmation = true
        }) {
            Text("delete_account_button".localized)
                .font(.system(size: 16, weight: .regular))
                .foregroundColor(.red)
                .frame(maxWidth: .infinity, alignment: .center)
                .lineLimit(1)
                .padding(12)
                .background(.red.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
        }
        .trackButtonTap("Delete Account")
    }
}
