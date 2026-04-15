//
//  CatalogueView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct CatalogueView: View {
    @State private var viewModel: CatalogueViewModel?
    private let coordinator: Coordinator
    private let diContainer: DIContainer

    init(coordinator: Coordinator, diContainer: DIContainer) {
        self.coordinator = coordinator
        self.diContainer = diContainer
    }

    var body: some View {
        Group {
            if let viewModel {
                CatalogueContentView(viewModel: viewModel)
            } else {
                LoadingPlaceholder()
            }
        }
        .navigationTitle(Tab.catalogue.navbarTitle)
        .trackScreenView("Catalogue")
        .safeAreaInset(edge: .bottom) {
            if let viewModel {
                AAXBannerView(action: {
                    HapticFeedback.trigger(style: .medium)
                    viewModel.presentImportOptions()
                })
                .padding(EdgeInsets(top: 0, leading: 16, bottom: 12, trailing: 16))
            }
        }
        .task {
            if viewModel == nil {
                viewModel = CatalogueViewModel(coordinator: coordinator, diContainer: diContainer)
            }
        }
    }
}

// MARK: - Content View (with non-optional ViewModel)

private struct CatalogueContentView: View {
    @Bindable var viewModel: CatalogueViewModel
    private let gridItemLayout = Array(repeating: GridItem(.flexible(), spacing: 20), count: 2)

    var body: some View {
        publicationListView
    }

    @ViewBuilder
    private var publicationListView: some View {
        switch viewModel.viewState {
        case .loading:
            LoadingPlaceholder()

        case .error(let message):
            ContentUnavailableView(
                "catalogue_error_title".localized,
                systemImage: "exclamationmark.triangle.fill",
                description: Text(message)
            )
            .transition(.scale.combined(with: .opacity))

        case .empty:
            ContentUnavailableView(
                "catalogue_empty_title".localized,
                systemImage: "books.vertical",
                description: Text("catalogue_empty_subtitle".localized)
            )
            .transition(.scale.combined(with: .opacity))

        case .loaded:
            catalogueContent
                .transition(.scale.combined(with: .opacity))
        }
    }

    private var catalogueContent: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(spacing: 24) {
                catalogueTabs
                publicationsGrid
            }
            .padding(EdgeInsets(top: 16, leading: 14, bottom: 20, trailing: 14))
        }
        .refreshable {
            try? await Task.sleep(for: .seconds(1))
            await viewModel.refreshCurrentTab()
        }
    }

    @ViewBuilder
    private var catalogueTabs: some View {
        if viewModel.isAAXConnected {
            Picker("", selection: $viewModel.selectedTab) {
                ForEach(SourceType.allCases) { tab in
                    Text(tab.description)
                        .tag(tab)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var publicationsGrid: some View {
        LazyVGrid(columns: gridItemLayout, spacing: 12) {
            ForEach(viewModel.publications) { publication in
                PublicationCell(publication: publication) {
                    viewModel.navigateToPublication(publication)
                }
            }

            if viewModel.hasMorePublications {
                loadMoreTrigger
            }

            if viewModel.isLoadingMore {
                loadingMoreIndicator
            }
        }
    }

    private var loadMoreTrigger: some View {
        Color.clear
            .frame(height: 1)
            .gridCellColumns(2)
            .task {
                await viewModel.loadMorePublications()
            }
    }

    private var loadingMoreIndicator: some View {
        ProgressView()
            .frame(maxWidth: .infinity)
            .gridCellColumns(2)
            .padding()
    }
}
