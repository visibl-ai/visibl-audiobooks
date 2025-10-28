//
//  AAXAccessibilityView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AAXAccessibilityView: View {
    @Environment(\.dismiss) var dismiss
    @ObservedObject private var viewModel: AAXViewModel
    @ObservedObject private var coordinator: AAXCoordinator
    @State private var isAccessibilityEnabled: Bool = false
    
    init(
        viewModel: AAXViewModel,
        coordinator: AAXCoordinator
    ) {
        self.viewModel = viewModel
        self.coordinator = coordinator
    }

    var body: some View {
        VStack(spacing: 24) {
            
            InfinityGallary()
                .overlay(
                    LinearGradient(
                        gradient: Gradient(
                            colors: [
                                .clear,
                                Color(UIColor.systemBackground)
                            ]
                        ),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            
            VStack(spacing: 12) {
                VStack(spacing: 6) {
                    Text(String(format: "aax_accessibility_title".localized, viewModel.aaxProviderName))
                        .font(.system(size: 30, weight: .bold, design: .serif))
                        .frame(maxWidth: .infinity, alignment: .center)
                    
                    Text(String(format: "aax_accessibility_description".localized, viewModel.aaxProviderName, viewModel.aaxProviderName))
                        .font(.system(size: 15, weight: .regular))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .multilineTextAlignment(.center)
                }
                
                HStack {
                    Image(systemName: isAccessibilityEnabled ? "checkmark.square.fill" : "square")
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(.customIndigo)
                    
                    Text("aax_accessibility_call_to_action".localized)
                        .font(.system(size: 14, weight: .regular))
                }
                .padding(.top, 12)
                .onTapGesture {
                    HapticFeedback.shared.trigger(style: .medium)
                    isAccessibilityEnabled.toggle()
                }
            }
            .padding(.horizontal, 14)
            
        }
        .padding(.bottom, 14)
        .navigationBarBackButtonHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarTitle(String(format: "aax_accessibility_navbar_title".localized, viewModel.aaxProviderName))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(action: {
                    HapticFeedback.shared.trigger(style: .light)
                    dismiss()
                }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14))
                        .foregroundStyle(.customBlack)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            ActionButton(
                isDisabled: !isAccessibilityEnabled,
                text: "continue_btn".localized
            ) {
                coordinator.navigateToCountryList()
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .trackScreenView("AAX Accessibility")
    }
}
