//
//  AAXCountryPickerView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AAXCountryPickerView: View {
    @ObservedObject private var viewModel: AAXViewModel
    @ObservedObject private var coordinator: AAXCoordinator
    private let dismiss: () -> Void
    
    init(
        viewModel: AAXViewModel,
        coordinator: AAXCoordinator,
        dismiss: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        self.coordinator = coordinator
        self.dismiss = dismiss
    }
    
    var body: some View {
        List(AAXCountry.allCases) { country in
            HStack {
                Text(country.flag)
                Text(country.localizedName)
                    .font(.system(size: 15, weight: .medium))
                
                Rectangle().fill(Color(.systemBackground))
                
                if country == viewModel.selectedCountryCode {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.green)
                }
            }
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.selectedCountryCode = country
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarTitle("aax_country_picker_navbar_title".localized)
        .navigationBarBackButtonHidden(true)
        .safeAreaInset(edge: .bottom) {
            ActionButton(text: "continue_btn".localized) {
                Task {
                    await viewModel.requestAuth()
                    coordinator.navigateToWebview()
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
        .trackScreenView("AAX Country Picker")
    }
}
