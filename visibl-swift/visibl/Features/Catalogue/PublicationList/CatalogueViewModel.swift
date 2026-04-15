//
//  CatalogueViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Combine
import Kingfisher

@Observable final class CatalogueViewModel {
    enum ViewState {
        case loading
        case loaded
        case empty
        case error(String)
    }

    var selectedTab: SourceType = .visibl {
        didSet {
            coordinator.selectedCatalogueSource = selectedTab
        }
    }

    var publicPublications: [PublicationPreviewModel] = []
    var privatePublications: [PublicationPreviewModel] = []
    var uploadedPublications: [PublicationPreviewModel] = []
    var isLoading = false
    var isLoadingMorePublic = false
    var isLoadingMorePrivate = false
    var isLoadingMoreUploaded = false
    var errorMessage: String?
    var isAAXConnected = false

    let coordinator: Coordinator
    let diContainer: DIContainer

    private let catalogueService = CatalogueService.shared
    private var currentPublicPage = 0
    private var currentPrivatePage = 0
    private var currentUploadedPage = 0
    private var cancellables = Set<AnyCancellable>()

    var publications: [PublicationPreviewModel] {
        switch selectedTab {
        case .visibl:
            return publicPublications
        case .aax:
            return privatePublications
        case .uploaded:
            return uploadedPublications
        }
    }

    private var hasMorePublicationsPublic = true
    private var hasMorePublicationsPrivate = true
    private var hasMorePublicationsUploaded = true

    var hasMorePublications: Bool {
        switch selectedTab {
        case .visibl:
            return hasMorePublicationsPublic
        case .aax:
            return hasMorePublicationsPrivate
        case .uploaded:
            return hasMorePublicationsUploaded
        }
    }

    var isLoadingMore: Bool {
        switch selectedTab {
        case .visibl:
            return isLoadingMorePublic
        case .aax:
            return isLoadingMorePrivate
        case .uploaded:
            return isLoadingMoreUploaded
        }
    }

    var viewState: ViewState {
        if isLoading { return .loading }
        if let errorMessage { return .error(errorMessage) }
        if publications.isEmpty { return .empty }
        return .loaded
    }

    init(coordinator: Coordinator, diContainer: DIContainer) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        observeAAXAuth()
        observeUploadedPublicationsChange()
        Task { await loadInitialPublications() }
    }

    // MARK: - Loading

    @MainActor
    func loadInitialPublications() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        do {
            _ = try await catalogueService.fetchPublicPublicationIds()
            currentPublicPage = 0
            publicPublications = await catalogueService.fetchPublications(for: .visibl, page: 0)
            hasMorePublicationsPublic = await catalogueService.hasMore(for: .visibl, loadedCount: publicPublications.count)

            _ = try await catalogueService.fetchPrivatePublicationIds()
            currentPrivatePage = 0
            privatePublications = await catalogueService.fetchPublications(for: .aax, page: 0)
            hasMorePublicationsPrivate = await catalogueService.hasMore(for: .aax, loadedCount: privatePublications.count)

            _ = try await catalogueService.fetchUploadedPublicationIds()
            currentUploadedPage = 0
            uploadedPublications = await catalogueService.fetchPublications(for: .uploaded, page: 0)
            hasMorePublicationsUploaded = await catalogueService.hasMore(for: .uploaded, loadedCount: uploadedPublications.count)
        } catch {
            errorMessage = "Failed to load publications: \(error.localizedDescription)"
        }

        isLoading = false
    }

    @MainActor
    func loadMorePublications() async {
        switch selectedTab {
        case .visibl:
            await loadMorePublic()
        case .aax:
            await loadMorePrivate()
        case .uploaded:
            await loadMoreUploaded()
        }
    }

    @MainActor
    private func loadMorePublic() async {
        guard !isLoadingMorePublic, hasMorePublications else { return }
        isLoadingMorePublic = true

        currentPublicPage += 1
        let nextPage = await catalogueService.fetchPublications(for: .visibl, page: currentPublicPage)
        publicPublications.append(contentsOf: nextPage)
        hasMorePublicationsPublic = await catalogueService.hasMore(for: .visibl, loadedCount: publicPublications.count)

        isLoadingMorePublic = false
    }

    @MainActor
    private func loadMorePrivate() async {
        guard !isLoadingMorePrivate, hasMorePublications else { return }
        isLoadingMorePrivate = true

        currentPrivatePage += 1
        let nextPage = await catalogueService.fetchPublications(for: .aax, page: currentPrivatePage)
        privatePublications.append(contentsOf: nextPage)
        hasMorePublicationsPrivate = await catalogueService.hasMore(for: .aax, loadedCount: privatePublications.count)

        isLoadingMorePrivate = false
    }

    @MainActor
    private func loadMoreUploaded() async {
        guard !isLoadingMoreUploaded, hasMorePublications else { return }
        isLoadingMoreUploaded = true

        currentUploadedPage += 1
        let nextPage = await catalogueService.fetchPublications(for: .uploaded, page: currentUploadedPage)
        uploadedPublications.append(contentsOf: nextPage)
        hasMorePublicationsUploaded = await catalogueService.hasMore(for: .uploaded, loadedCount: uploadedPublications.count)

        isLoadingMoreUploaded = false
    }

    // MARK: - Refresh

    @MainActor
    func refreshCurrentTab() async {
        // Clear Kingfisher cache for current tab's images before refreshing
        clearImageCache(for: selectedTab)

        switch selectedTab {
        case .visibl:
            currentPublicPage = 0
            await catalogueService.reset(for: .visibl)
            _ = try? await catalogueService.fetchPublicPublicationIds()
            let newPublications = await catalogueService.fetchPublications(for: .visibl, page: 0)
            publicPublications = newPublications
            hasMorePublicationsPublic = await catalogueService.hasMore(for: .visibl, loadedCount: publicPublications.count)

        case .aax:
            currentPrivatePage = 0
            await catalogueService.reset(for: .aax)
            _ = try? await catalogueService.fetchPrivatePublicationIds()
            let newPublications = await catalogueService.fetchPublications(for: .aax, page: 0)
            privatePublications = newPublications
            hasMorePublicationsPrivate = await catalogueService.hasMore(for: .aax, loadedCount: privatePublications.count)

        case .uploaded:
            currentUploadedPage = 0
            await catalogueService.reset(for: .uploaded)
            _ = try? await catalogueService.fetchUploadedPublicationIds()
            let newPublications = await catalogueService.fetchPublications(for: .uploaded, page: 0)
            uploadedPublications = newPublications
            hasMorePublicationsUploaded = await catalogueService.hasMore(for: .uploaded, loadedCount: uploadedPublications.count)
        }
    }

    private func clearImageCache(for sourceType: SourceType) {
        let publications: [PublicationPreviewModel]
        switch sourceType {
        case .visibl:
            publications = publicPublications
        case .aax:
            publications = privatePublications
        case .uploaded:
            publications = uploadedPublications
        }

        let cache = ImageCache.default
        for publication in publications {
            guard let coverUrl = publication.coverUrl else { continue }
            cache.removeImage(forKey: coverUrl)
        }
    }

    // MARK: - AAX

    private func observeAAXAuth() {
        diContainer.aaxAuthDataObserver.$aaxAuthData
            .sink { [weak self] aaxAuthData in
                guard let self else { return }
                let wasConnected = isAAXConnected
                let isNowConnected = aaxAuthData != nil
                isAAXConnected = isNowConnected

                if !wasConnected && isNowConnected {
                    Task { @MainActor in
                        _ = try? await self.catalogueService.fetchPrivatePublicationIds()
                        self.currentPrivatePage = 0
                        self.privatePublications = await self.catalogueService.fetchPublications(for: .aax, page: 0)
                        self.hasMorePublicationsPrivate = await self.catalogueService.hasMore(for: .aax, loadedCount: self.privatePublications.count)
                    }
                } else if wasConnected && !isNowConnected {
                    Task { @MainActor in
                        self.selectedTab = .visibl
                        self.privatePublications = []
                        self.currentPrivatePage = 0
                        await self.catalogueService.resetAll()
                    }
                }
            }
            .store(in: &cancellables)
    }

    func handleAAXBannerTap() {
        HapticFeedback.trigger(style: .light)

        if diContainer.authService.isUserSignedIn() {
            coordinator.presentSheet(.aaxSignIn(onSuccess: {
                self.coordinator.selectedCatalogueSource = .aax
            }))
        } else {
            AlertUtil.shared.showAlert(
                alertTitle: "catalogue_sign_in_required_alert_title".localized,
                alertMessage: "catalogue_sign_in_required_alert_message".localized,
                alertButtons: [
                    .default("catalogue_sign_in_required_alert_sign_in_btn".localized) { [weak self] in
                        self?.coordinator.presentSheet(.signIn)
                    },
                    .cancel("catalogue_sign_in_required_alert_cancel_btn".localized) {}
                ]
            )
        }
    }

    // MARK: - Navigation

    func navigateToPublication(_ publication: PublicationPreviewModel) {
        coordinator.navigateTo(.publicationDetails(publication: publication))
    }
    
    func presentImportOptions() {
        coordinator.presentSheet(.importOptions)
    }

    // MARK: - Observers

    private func observeUploadedPublicationsChange() {
        NotificationCenter.default.publisher(for: .uploadedPublicationsDidChange)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.selectedTab = .uploaded
                    await self?.refreshCurrentTab()
                }
            }
            .store(in: &cancellables)
    }
}
