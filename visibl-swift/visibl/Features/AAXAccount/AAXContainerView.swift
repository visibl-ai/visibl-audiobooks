//
//  AAXContainerView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AAXContainerView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel: AAXViewModel
    @StateObject private var coordinator: AAXCoordinator
        
    init(
        aaxClient: AAXClientWrapper,
        onSuccess: (() -> Void)? = nil
    ) {
        self._viewModel = StateObject(wrappedValue: AAXViewModel(
            aaxClient: aaxClient,
            onSuccess: onSuccess
        ))
        self._coordinator = StateObject(wrappedValue: AAXCoordinator())
    }
    
    var body: some View {
        NavigationStack(path: $coordinator.navigationPath) {
            AAXAccessibilityView(
                viewModel: viewModel,
                coordinator: coordinator
            )
            .navigationDestination(for: AAXDestination.self) { destination in
                destinationView(for: destination)
            }
        }
    }
    
    @ViewBuilder
    private func destinationView(for destination: AAXDestination) -> some View {
        switch destination {
        case .navigateToCountryList:
            AAXCountryPickerView(
                viewModel: viewModel,
                coordinator: coordinator,
                dismiss: { dismiss() }
            )
        case .navigateToWebview:
            AAXWebViewContainer(
                viewModel: viewModel,
                coordinator: coordinator,
                dismiss: { dismiss() }
            )
        }
    }
}
