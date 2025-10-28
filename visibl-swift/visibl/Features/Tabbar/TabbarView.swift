//
//  TabbarView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct TabbarView: View {
    @ObservedObject var appCoordinator: AppCoordinator
    private let myLibraryCoordinator: Coordinator
    private let catalogueCoordinator: Coordinator
    private let settingsCoordinator: Coordinator
    private let diContainer: DIContainer
    
    init(
        appCoordinator: AppCoordinator,
        diContainer: DIContainer
    ) {
        self.appCoordinator = appCoordinator
        self.diContainer = diContainer
        self.myLibraryCoordinator = appCoordinator.makeMyLibraryCoordinator()
        self.catalogueCoordinator = appCoordinator.makeCatalogueCoordinator()
        self.settingsCoordinator = appCoordinator.makeSettingsCoordinator()
    }
    
    var body: some View {
        TabView(selection: $appCoordinator.selectedTab) {
            
            // MARK: - My Books
            NavigationStack(path: $appCoordinator.myLibraryNavigationPath) {
                MyLibraryView(
                    coordinator: myLibraryCoordinator,
                    diContainer: diContainer
                )
                .toolbarBackground(.visible, for: .tabBar)
                .navigationDestination(for: NavigationDestination.self) { destination in
                    destinationView(
                        for: destination,
                        coordinator: myLibraryCoordinator
                    )
                }
            }
            .tabItem {
                Image(systemName: Tab.myLibrary.icon)
                Text(Tab.myLibrary.tabbarTitle)
            }
            .tag(Tab.myLibrary)
            
            // MARK: - Catalogue
            NavigationStack(path: $appCoordinator.catalogueNavigationPath) {
                CatalogueView(
                    coordinator: catalogueCoordinator,
                    diContainer: diContainer
                )
                .toolbarBackground(.visible, for: .tabBar)
                .navigationDestination(for: NavigationDestination.self) { destination in
                    destinationView(
                        for: destination,
                        coordinator: catalogueCoordinator
                    )
                }
            }
            .tabItem {
                Image(systemName: Tab.catalogue.icon)
                Text(Tab.catalogue.tabbarTitle)
            }
            .tag(Tab.catalogue)
            
            // MARK: - Settings
            NavigationStack(path: $appCoordinator.settingsNavigationPath) {
                SettingsView(
                    coordinator: settingsCoordinator,
                    diContainer: diContainer
                )
                .toolbarBackground(.visible, for: .tabBar)
                .navigationDestination(for: NavigationDestination.self) { destination in
                    destinationView(
                        for: destination,
                        coordinator: settingsCoordinator
                    )
                }
            }
            .tabItem {
                Image(systemName: Tab.settings.icon)
                Text(Tab.settings.tabbarTitle)
            }
            .tag(Tab.settings)
        }
        .tint(.customPrimary)
        .onChange(of: appCoordinator.selectedTab) { new, old in
            HapticFeedback.shared.trigger(style: .light)
        }
        .sheet(item: $appCoordinator.activeSheet) { destination in
            modalDestinationView(for: destination, coordinator: getCurrentTabCoordinator())
        }
        .fullScreenCover(item: $appCoordinator.activeFullScreenCover) { destination in
            modalDestinationView(for: destination, coordinator: getCurrentTabCoordinator())
        }
    }
}

// MARK: - Navigation Destinations

private extension TabbarView {
    @ViewBuilder func destinationView(for destination: NavigationDestination, coordinator: any Coordinator) -> some View {
        switch destination {
        case .publicationDetails(let publication):
            PublicationDetailsView(
                publication: publication,
                coordinator: coordinator,
                diContainer: diContainer
            )
        }
    }
}

// MARK: - Modal Destinations

private extension TabbarView {
    @ViewBuilder func modalDestinationView(for destination: ModalDestination, coordinator: any Coordinator) -> some View {
        switch destination {
        case .player(let coordinator, let audiobook):
            PlayerView(coordinator: coordinator, diContainer: diContainer, audiobook: audiobook)
        case .signIn:
            AuthContainerView(
                authService: diContainer.authService,
                player: diContainer.player,
                aaxPipeline: diContainer.aaxPipeline
            )
            .presentationDragIndicator(.visible)
        case .signInFromPlayer(let audiobook, let onSuccess):
            AuthContainerView(
                authService: diContainer.authService,
                player: diContainer.player,
                aaxPipeline: diContainer.aaxPipeline,
                audiobook: audiobook,
                onSuccess: onSuccess
            )
            .presentationDragIndicator(.visible)
        case .aaxSignIn(let onSuccess):
            AAXContainerView(
                aaxClient: diContainer.aaxClient,
                onSuccess: onSuccess
            )
        case .appAppearance:
            AppAppearanceSelection()
                .presentationDetents([.height(250)])
                .presentationCornerRadius(16)
        case .sendMail(let subject):
            if MailComposeView.canSendMail {
                MailComposeView(subject: subject)
                    .presentationCornerRadius(18)
            } else {
                Text("Mail cannot be sent")
                    .presentationCornerRadius(18)
            }
        }
    }
}

// MARK: - Helper Methods

private extension TabbarView {
    private func getCurrentTabCoordinator() -> Coordinator {
        switch appCoordinator.selectedTab {
        case .myLibrary:
            return myLibraryCoordinator
        case .catalogue:
            return catalogueCoordinator
        case .settings:
            return settingsCoordinator
        }
    }
}
