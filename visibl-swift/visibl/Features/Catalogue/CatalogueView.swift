//
//  CatalogueView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct CatalogueView: View {
    private let coordinator: Coordinator
    @ObservedObject private var userConfig = UserConfigurations.shared
    @StateObject private var viewModel: CatalogueViewModel
    private var gridItemLayout = Array(repeating: GridItem(.flexible(), spacing: 20), count: 2)
    private let diContainer: DIContainer
    @ObservedObject private var analytics: AnalyticsManager = .shared
    
    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        
        _viewModel = StateObject(wrappedValue: CatalogueViewModel(
            catalogueObserver: diContainer.catalogueObserver,
            userLibraryObserver: diContainer.userLibraryObserver,
            aaxCatalogueObserver: diContainer.aaxCatalogueObserver,
            aaxClient: diContainer.aaxClient,
            aaxAuthDataObserver: diContainer.aaxAuthDataObserver
        ))
    }
    
    var body: some View {
        mainView
            .trackScreenView("Catalogue")
            .navigationTitle(Tab.catalogue.navbarTitle)
            .safeAreaInset(edge: .bottom) {
                if viewModel.isAAXConnected {
                    NowPlayingView(coordinator: coordinator, diContainer: diContainer)
                } else {
                    connectAAXView
                }
            }
            .onAppear {
                updateSelectedSourceType()
            }
            .onChange(of: viewModel.isAAXConnected) {
                updateSelectedSourceType()
                coordinator.navigateToRoot()
            }
    }
    
    @ViewBuilder
    private var mainView: some View {
        ScrollView {
            VStack(spacing: 0) {
                if diContainer.aaxClient.aaxAuthData != nil {
                    segmentedControl
                }
                
                switch coordinator.selectedCatalogueSource {
                case .visibl:
                    if viewModel.isPublicaFeedLoading {
                        LoadingPlaceholder()
                    } else {
                        makeBookGrid(
                            publications: viewModel.publicPublications,
                            isLoading: viewModel.isPublicaFeedLoading
                        )
                    }
                case .aax:
                    if viewModel.isPrivateFeedLoading {
                        LoadingPlaceholder()
                    } else {
                        if viewModel.privatePublications.isEmpty {
                            CataloguePlaceholder(
                                icon: "square.stack.3d.up.fill",
                                title: "catalogue_aax_placeholder_title".localized,
                                subtitle: "catalogue_aax_placeholder_subtitle".localized
                            )
                        } else {
                            makeBookGrid(
                                publications: viewModel.privatePublications,
                                isLoading: viewModel.isPrivateFeedLoading
                            )
                        }
                    }
                }
            }
        }
    }
}

private extension CatalogueView {
    private var segmentedControl: some View {
        CustomSegmentedControl(selectedValue: Binding(
            get: { coordinator.selectedCatalogueSource },
            set: { coordinator.selectedCatalogueSource = $0 }
        ))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }
    
    @ViewBuilder
    private func makeBookGrid(publications: [PublicationModel], isLoading: Bool) -> some View {
        if isLoading {
            ZStack {
                Spacer().containerRelativeFrame([.horizontal, .vertical])
                LoadingPlaceholder()
            }
        } else {
            LazyVGrid(columns: gridItemLayout, spacing: 12) {
                ForEach(publications) { publication in
                    CatalogueGridCell(publication: publication) {
                        HapticFeedback.shared.trigger(style: .light)
                        coordinator.navigateTo(.publicationDetails(publication))
                    }
                }
            }
            .padding(EdgeInsets(top: 16, leading: 14, bottom: 20, trailing: 14))
        }
    }
}

private extension CatalogueView {
    private func updateSelectedSourceType() {
        if diContainer.aaxClient.aaxAuthData == nil {
            coordinator.selectedCatalogueSource = .visibl
        }
    }
}

private extension CatalogueView {
    private var connectAAXView: some View {
        AAXBannerView(action: {
            HapticFeedback.shared.trigger(style: .light)
            
            if diContainer.authService.isUserSignedIn() {
                let onSuccessHandler = { coordinator.selectedCatalogueSource = .aax }
                coordinator.presentSheet(.aaxSignIn(onSuccess: onSuccessHandler))
            } else {
                signInRequiredAlert()
            }
            
            analytics.captureButtonTap("Sign in to AAX")
        })
    }
}

private extension CatalogueView {
    private func signInRequiredAlert() {
        AlertManager.shared.showAlert(
            alertTitle: "catalogue_sign_in_required_alert_title".localized,
            alertMessage: "catalogue_sign_in_required_alert_message".localized,
            alertButtons: [
                .default("catalogue_sign_in_required_alert_sign_in_btn".localized) {
                    coordinator.presentSheet(.signIn)
                },
                .cancel("catalogue_sign_in_required_alert_cancel_btn".localized) {}
            ]
        )
    }
}
