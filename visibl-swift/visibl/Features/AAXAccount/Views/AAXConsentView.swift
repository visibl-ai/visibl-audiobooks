//
//  AAXConsentView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct AAXConsentView: View {
    @ObservedObject private var viewModel: AAXViewModel
    let onAccept: () -> Void
    let onDecline: () -> Void
    
    init(
        viewModel: AAXViewModel,
        onAccept: @escaping () -> Void,
        onDecline: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        self.onAccept = onAccept
        self.onDecline = onDecline
    }
    
    var body: some View {
        ZStack {
            dialogView
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .trackScreenView("AAX Consent")
    }
    
    private var dialogView: some View {
        VStack(spacing: 12) {
            logoImages
            title
            description
            points
            buttons
            bottomConsent
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 24)
        .background(.customBackground2, in: .rect(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.gray.opacity(0.18), lineWidth: 1)
        )
        .padding(24)
    }
    
    private var logoImages: some View {
        HStack(spacing: 12) {
            Image("logo")
                .resizable()
                .frame(width: 86, height: 86)
                .clipShape(.rect(cornerRadius: 16))
            
            Image(systemName: "chevron.left")
                .font(.system(size: 26, weight: .medium))
            
            KFImage(URL(string: viewModel.aaxProviderLogo))
                .resizable()
                .placeholder {
                    Color.gray
                }
                .scaledToFill()
                .frame(width: 86, height: 86)
                .clipShape(.rect(cornerRadius: 16))
        }
        .padding(.bottom, 12)
    }
    
    private var title: some View {
        Text(String(format: "aax_consent_screen_title".localized, viewModel.aaxProviderName))
            .font(.system(size: 30, weight: .bold, design: .serif))
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
    }
    
    private var description: some View {
        Text(makeDescriptionAttributedString())
            .font(.system(size: 14, weight: .regular))
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
    }
    
    private func makeDescriptionAttributedString() -> AttributedString {
        let baseText = "aax_consent_description".localized
        let linkText = "aax_consent_learn_more".localized
        let fullText = "\(baseText) \(linkText)."
        
        var attributedString = AttributedString(fullText)
        
        if let range = attributedString.range(of: linkText) {
            attributedString[range].link = URL(string: viewModel.aaxConsentURL)
        }
        
        return attributedString
    }
    
    private var points: some View {
        VStack(spacing: 6) {
            makePoint(text: String(format: "aax_consent_point_1".localized, viewModel.aaxProviderName, viewModel.aaxProviderCompany))
            makePoint(text: "aax_consent_point_2".localized)
            makePoint(text: "aax_consent_point_3".localized)
        }
    }
    
    private func makePoint(text: String) -> some View {
        HStack(alignment: .top) {
            Image(systemName: "circle.fill")
                .font(.system(size: 7))
                .foregroundStyle(.gray)
                .padding(.top, 4)
            
            Text(text)
                .font(.system(size: 13, weight: .regular))
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 5)
    }
    
    private var buttons: some View {
        HStack {
            Button(action: {
                HapticFeedback.shared.trigger(style: .medium)
                onDecline()
            }) {
                Text("aax_consent_decline".localized)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background {
                        if #available(iOS 26.0, *) {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.clear)
                                .glassEffect(.regular.tint(.red), in: .rect(cornerRadius: 12))
                        } else {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.red.gradient)
                        }
                    }
            }
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .medium)
                onAccept()
            }) {
                Text("aax_consent_accept".localized)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background {
                        if #available(iOS 26.0, *) {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.clear)
                                .glassEffect(.regular.tint(.customIndigo), in: .rect(cornerRadius: 12))
                        } else {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.customIndigo.gradient)
                        }
                    }
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
    
    private var bottomConsent: some View {
        Text(String(format: "aax_consent_disclaimer".localized, viewModel.aaxProviderName, viewModel.aaxProviderName, viewModel.aaxProviderCompany))
            .font(.system(size: 12, weight: .light))
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
    }
}
