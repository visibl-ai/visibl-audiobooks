//
//  AppCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import SwiftUI

protocol Coordinator: AnyObject {
    func selectTab(_ tab: Tab, action: (() -> Void)?)
    func navigateTo(_ destination: NavigationDestination)
    func navigateBack()
    func navigateToRoot()
    func presentSheet(_ destination: ModalDestination)
    func presentFullScreenCover(_ destination: ModalDestination)
    func dismissModal(action: (() -> Void)?)
    var selectedCatalogueSource: SourceType { get set }
}

extension Coordinator {
    func selectTab(_ tab: Tab) { selectTab(tab, action: nil) }
    func dismissModal() { dismissModal(action: nil) }
}

enum NavigationDestination: Hashable, Equatable, Identifiable {
    case publicationDetails(PublicationModel)
    
    var id: String {
        switch self {
        case .publicationDetails: return "publicationDetails"
        }
    }
}

enum Tab: String {
    case myLibrary, catalogue, settings
    
    var tabbarTitle: String {
        switch self {
        case .myLibrary: return "library_tab".localized
        case .catalogue: return "store_tab".localized
        case .settings: return "settings_tab".localized
        }
    }
    
    var navbarTitle: String {
        switch self {
        case .myLibrary: return "library_screen_title".localized
        case .catalogue: return "store_screen_title".localized
        case .settings: return "settings_screen_title".localized
        }
    }
    
    var icon: String {
        switch self {
        case .myLibrary: return "books.vertical"
        case .catalogue: return "bag"
        case .settings: return "gearshape"
        }
    }
}

enum Destination: Hashable, Equatable {
    case publicationDetails(PublicationModel, DIContainer)
}

enum ModalDestination: Identifiable {
    case player(Coordinator, AudiobookModel)
    case signIn
    case signInFromPlayer(AudiobookModel, onSuccess: (() -> Void)? = nil)
    case aaxSignIn(onSuccess: (() -> Void)? = nil)
    case appAppearance
    case sendMail(String)
    
    var id: String {
        switch self {
        case .player: return "player"
        case .signIn: return "signIn"
        case .signInFromPlayer: return "signInFromPlayer"
        case .aaxSignIn: return "aaxSignIn"
        case .appAppearance: return "appAppearance"
        case .sendMail: return "sendMail"
        }
    }
}

class AppCoordinator: ObservableObject {
    @Published var selectedTab: Tab = .myLibrary
    @Published var selectedCatalogueSource: SourceType = .visibl
    @Published var myLibraryNavigationPath = NavigationPath()
    @Published var catalogueNavigationPath = NavigationPath()
    @Published var settingsNavigationPath = NavigationPath()
    
    @Published var activeSheet: ModalDestination?
    @Published var activeFullScreenCover: ModalDestination?
    
    func makeMyLibraryCoordinator() -> Coordinator {
        return TabCoordinator(appCoordinator: self, tabItem: .myLibrary)
    }
    
    func makeCatalogueCoordinator() -> Coordinator {
        return TabCoordinator(appCoordinator: self, tabItem: .catalogue)
    }
    
    func makeSettingsCoordinator() -> Coordinator {
        return TabCoordinator(appCoordinator: self, tabItem: .settings)
    }
    
    func selectTab(_ tab: Tab, action: (() -> Void)? = nil) {
        selectedTab = tab
        action?()
    }
    
    func navigateTo(_ destination: NavigationDestination, from tab: Tab) {
        switch tab {
        case .myLibrary:
            myLibraryNavigationPath.append(destination)
        case .catalogue:
            catalogueNavigationPath.append(destination)
        case .settings:
            settingsNavigationPath.append(destination)
        }
    }
    
    func navigateBack(from tab: Tab) {
        switch tab {
        case .myLibrary:
            if !myLibraryNavigationPath.isEmpty {
                myLibraryNavigationPath.removeLast()
            }
        case .catalogue:
            if !catalogueNavigationPath.isEmpty {
                catalogueNavigationPath.removeLast()
            }
        case .settings:
            if !settingsNavigationPath.isEmpty {
                settingsNavigationPath.removeLast()
            }
        }
    }
    
    func navigateToRoot(from tab: Tab) {
        switch tab {
        case .myLibrary:
            myLibraryNavigationPath = NavigationPath()
        case .catalogue:
            catalogueNavigationPath = NavigationPath()
        case .settings:
            settingsNavigationPath = NavigationPath()
        }
    }
    
    func presentSheet(_ destination: ModalDestination) {
        activeSheet = destination
    }
    
    func presentFullScreenCover(_ destination: ModalDestination) {
        activeFullScreenCover = destination
    }
    
    func dismissModal(action: (() -> Void)? = nil) {
        activeSheet = nil
        activeFullScreenCover = nil
        action?()
    }
}

class TabCoordinator: Coordinator {
    var selectedCatalogueSource: SourceType {
        get { appCoordinator.selectedCatalogueSource }
        set { appCoordinator.selectedCatalogueSource = newValue }
    }
    
    private let appCoordinator: AppCoordinator
    private let tabItem: Tab
    
    init(appCoordinator: AppCoordinator, tabItem: Tab) {
        self.appCoordinator = appCoordinator
        self.tabItem = tabItem
    }
    
    func navigateTo(_ destination: NavigationDestination) {
        appCoordinator.navigateTo(destination, from: tabItem)
    }
    
    func navigateBack() {
        appCoordinator.navigateBack(from: tabItem)
    }
    
    func navigateToRoot() {
        appCoordinator.navigateToRoot(from: tabItem)
    }
    
    func selectTab(_ tab: Tab, action: (() -> Void)? = nil) {
        appCoordinator.selectTab(tab, action: action)
    }
    
    func presentSheet(_ destination: ModalDestination) {
        appCoordinator.presentSheet(destination)
    }
    
    func presentFullScreenCover(_ destination: ModalDestination) {
        appCoordinator.presentFullScreenCover(destination)
    }
    
    func dismissModal(action: (() -> Void)? = nil) {
        appCoordinator.dismissModal(action: action)
    }
}
