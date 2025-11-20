//
//  MyLibraryView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Mixpanel

struct MyLibraryView: View {
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    @StateObject private var viewModel: MyLibraryViewModel
    @ObservedObject private var userConfig = UserConfigurations.shared
    private var gridItemLayout = Array(repeating: GridItem(.flexible(), spacing: 20), count: 2)
    @ObservedObject private var analytics: AnalyticsManager
    
    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        
        _viewModel = StateObject(wrappedValue: MyLibraryViewModel(
            catalogueObserver: diContainer.catalogueObserver,
            userLibraryObserver: diContainer.userLibraryObserver,
            aaxCatalogueObserver: diContainer.aaxCatalogueObserver,
            player: diContainer.player,
            aaxClient: diContainer.aaxClient,
            aaxPipeline: diContainer.aaxPipeline
        ))
        
        self.analytics = .shared
    }
    
    var body: some View {
        library
            .trackScreenView("My Libarry")
            .navigationBarTitleDisplayMode(.large)
            .navigationTitle(Tab.myLibrary.navbarTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        toolbarMenu
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                NowPlayingView(coordinator: coordinator, diContainer: diContainer)
            }
            .onChange(of: viewModel.audiobooks) { oldValue, newValue in
                let sortedAudiobooks = newValue.sorted { $0.addedDate < $1.addedDate }
                
                Task {
                    for audiobook in sortedAudiobooks {
                        await viewModel.processAAXFile(audiobook)
                        await viewModel.validateAndUpdateVoucher(audiobook)
                    }
                }
            }
            .onChange(of: viewModel.isRecogizerReady) {
                let sortedAudiobooks = viewModel.audiobooks.sorted { $0.addedDate < $1.addedDate }
                
                Task {
                    for audiobook in sortedAudiobooks {
                        await viewModel.processAAXFile(audiobook)
                    }
                }
            }
            .onChange(of: viewModel.isAAXConnected) {
                coordinator.navigateToRoot()
            }
    }
    
    @ViewBuilder
    private var library: some View {
        if viewModel.isLoading {
            LoadingPlaceholder()
        } else {
            if diContainer.authService.isUserSignedIn() || diContainer.authService.isUserAnonymous() {
                ScrollView {
                    filterButtons
                    stayInAppInfoView
                    audiobooksView
                }
            } else {
                makePlaceholder(.signedOut)
            }
        }
    }
    
    @ViewBuilder private var audiobooksView: some View {
        if viewModel.displayedAudiobooks.isEmpty {
            makePlaceholder(viewModel.selectedFilter == .all ? .emptyLibrary : .emptyCollection)
        } else {
            if viewModel.selectedLayout == .grid {
                audiobookGrid
            } else {
                audiobookList
            }
        }
    }
    
    private var audiobookGrid: some View {
        LazyVGrid(columns: gridItemLayout, spacing: 12) {
            ForEach(viewModel.displayedAudiobooks) { audiobook in
                BookGridCell(
                    audiobook: audiobook,
                    aaxPipeline: diContainer.aaxPipeline
                ) {
                    playAudiobook(audiobook)
                }
                .contextMenu(menuItems: {
                    makeAudiobookCellMenu(audiobook)
                })
            }
        }
        .padding(EdgeInsets(top: 10, leading: 14, bottom: 20, trailing: 14))
    }
    
    private var audiobookList: some View {
        LazyVStack (spacing: 12) {
            ForEach(viewModel.displayedAudiobooks) { audiobook in
                BookListCell(
                    audiobook: audiobook,
                    aaxPipeline: diContainer.aaxPipeline,
                    action: {
                        playAudiobook(audiobook)
                    },
                    menuView:
                        Menu(content: {
                            makeAudiobookCellMenu(audiobook)
                        }) {
                            Image(systemName: "ellipsis")
                                .foregroundStyle(.customBlack)
                                .frame(width: 32, height: 32)
                                .background(.clear, in: .rect(cornerRadius: 6))
                        }
                )
            }
        }
        .padding(EdgeInsets(top: 10, leading: 14, bottom: 20, trailing: 14))
    }
    
    private var filterButtons: some View {
        ScrollViewReader { proxy in
            ScrollView (.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(MyLibraryFilterOption.allCases) { option in
                        MyLibraryFilterButton(
                            option: option,
                            isSelected: viewModel.selectedFilter == option
                        ) {
                            HapticFeedback.shared.trigger(style: .light)
                            viewModel.selectedFilter = option
                        }
                        .id(option.id)
                        .trackButtonTap(option.title)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            .onChange(of: viewModel.selectedFilter) {
                withAnimation(.easeInOut(duration: 0.3)) {
                    proxy.scrollTo(viewModel.selectedFilter.id, anchor: .center)
                }
            }
        }
    }
    
    private func makePlaceholder(_ type: MyLibraryPlaceholderType) -> some View {
        MyLibraryPlaceholder(type: type) {
            switch type {
            case .signedOut:
                coordinator.presentSheet(.signIn)
            case .emptyLibrary:
                coordinator.selectTab(.catalogue)
            case .emptyCollection:
                print("Collection is Empty")
            }
        }
        .padding(.top, type == .signedOut ? 0 : UIScreen.main.bounds.height * 0.15)
    }
    
    @ViewBuilder private var stayInAppInfoView: some View {
        if viewModel.isDownloadingAnyBook {
            VStack(spacing: 12) {
                HStack(alignment: .center, spacing: 9) {
                    Image(systemName: "info")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.customWhite)
                        .frame(width: 20, height: 20)
                        .background(.toastYellow, in: .rect(cornerRadius: 4))
                    
                    Text("stay_in_app_info_message".localized)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(.customBlack)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 16)
            .padding(.horizontal, 12)
            .background(.toastYellow.opacity(0.3), in: .rect(cornerRadius: 12))
            .padding(.horizontal, 14)
        }
    }
}

// MARK: - Play Audiobook

extension MyLibraryView {
    private func playAudiobook(_ audiobook: AudiobookModel) {
        analytics.captureEvent(
            "play_book",
            properties: [
                "book_id": audiobook.id,
                "book_title": audiobook.title,
                "author": audiobook.authors,
                "is_AAX": audiobook.isAAX
            ]
        )
        
        if !audiobook.isDownloaded && audiobook.isAAX {
            Toastify.show(
                style: .warning,
                message: String(format: "aax_not_downloaded_toast_warning".localized, audiobook.title)
            )
            
            return
        }
        
        if !audiobook.hasGraph {
            graphIsProcessingAlert(audiobook)
            return
        }
        
        if !audiobook.isPlayable {
            transcribingAlert(audiobook)
            return
        }
        
        if !audiobook.isVoucherValid {
            Task {
                await viewModel.validateAndUpdateVoucher(audiobook)
                
                await MainActor.run {
                    if !audiobook.isVoucherValid {
                        Toastify.show(
                            style: .error,
                            message: String(format: "aax_voucher_not_valid_toast_error".localized, audiobook.title)
                        )
                        
                        return
                    }
                    
                    if viewModel.isDownloading(audiobook) {
                        voucherIsNotValidAlert(audiobook)
                    } else {
                        coordinator.presentFullScreenCover(.player(coordinator, audiobook))
                    }
                }
            }
            
            return
        }
        
        if viewModel.isDownloading(audiobook) {
            audiobookIsDownloadingAlert(audiobook)
        } else {
            if audiobook.isAAX {
                Mixpanel.mainInstance().track(event: "aax_book_played")
            } else {
                Mixpanel.mainInstance().track(event: "public_book_played")
            }
            
            coordinator.presentFullScreenCover(.player(coordinator, audiobook))
        }
    }
}

// MARK: - Toolbar Menu Button (Library Setup)

extension MyLibraryView {
    private var toolbarMenu: some View {
        Menu {
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.selectedFilter = .all
                viewModel.selectedLayout = .grid
            }) {
                Label("my_books_layout_grid".localized, systemImage: "square.grid.2x2")
            }
            .labelStyle(.titleAndIcon)
            .trackButtonTap("my_books_layout_grid".localized)
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.selectedFilter = .all
                viewModel.selectedLayout = .list
            }) {
                Label("my_books_layout_list".localized, systemImage: "list.bullet")
            }
            .labelStyle(.titleAndIcon)
            .trackButtonTap("my_books_layout_list".localized)
            
            Divider()
            
            Section(header: Text("my_books_sort_by_title".localized)) {
                ForEach(MyLibrarySortingOption.allCases) { option in
                    Button(action: {
                        HapticFeedback.shared.trigger(style: .light)
                        viewModel.selectedSorting = option
                    }) {
                        Label {
                            Text(option.title)
                        } icon: {
                            if viewModel.selectedSorting == option {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    .trackButtonTap(option.title)
                }
            }
        } label: {
            if #available(iOS 26.0, *) {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(.customBlack)
            } else {
                Image(systemName: "ellipsis")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.customBlack)
                    .frame(width: 28, height: 28)
                    .background(Color(.systemGray6), in: .rect(cornerRadius: 8))
            }
        }
    }
}

// MARK: - Audiobook Cell Menu

extension MyLibraryView {
    private func makeAudiobookCellMenu(_ audiobook: AudiobookModel) -> some View {
        Section {
            // Debug-only button
            #if DEBUG
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                UIPasteboard.general.string = audiobook.id
                Toastify.show(style: .success, message: "Book ID copied to clipboard")
                print("Audiobook ID copied to clipboard: \(audiobook.id)")
                print("Completed chapters \(audiobook.publication.graphProgress?.completedChapters?.count)")
                // print("Chapter progress \(audiobook.publication.graphProgress?.chapterProgress)")
            }) {
                Label("Copy Book ID (Debug)", systemImage: "doc.on.clipboard")
            }
            
            Divider()
            #endif
            
            if !audiobook.isDownloaded && audiobook.isAAX {
                Button(action: {
                    HapticFeedback.shared.trigger(style: .light)
                    viewModel.restartDownload(audiobook)
                }) {
                    Label("my_books_restart_download".localized, systemImage: "arrow.clockwise")
                }
                .trackButtonTap("my_books_restart_download".localized)
            }
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.toggleFavorite(audiobook)
            }) {
                Label(
                    audiobook.isFavourite ? "my_books_favorite_remove".localized : "my_books_favorite_add".localized,
                    systemImage: audiobook.isFavourite ? "heart.fill" : "heart"
                )
            }
            .trackButtonTap("my_books_favorite_add".localized)
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                
                if viewModel.isAudiobookInPlayer(audiobook) {
                    audiobookIsNowPlayingAlert(audiobook)
                } else {
                    viewModel.markAsFinished(audiobook)
                }
            }) {
                Label("my_books_mark_finished".localized, systemImage: "flag.pattern.checkered")
            }
            .trackButtonTap("my_books_mark_finished".localized)
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                
                if viewModel.isAudiobookInPlayer(audiobook) {
                    audiobookIsNowPlayingAlert(audiobook)
                } else {
                    viewModel.resetProgress(audiobook)
                }
            }) {
                Label("my_books_reset_progress".localized, systemImage: "restart")
            }
            .trackButtonTap("my_books_reset_progress".localized)
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.moveToArchive(audiobook)
            }) {
                Label(
                    audiobook.isArchived ? "my_books_archive_remove".localized : "my_books_archive_move".localized,
                    systemImage: audiobook.isArchived ? "archivebox.fill" : "archivebox"
                )
            }
            .trackButtonTap("my_books_archive_move".localized)
            
            Divider()
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                coordinator.navigateTo(.publicationDetails(audiobook.publication))
            }) {
                Label("my_books_show_in_catalogue".localized, systemImage: "bag")
            }
            .trackButtonTap("my_books_show_in_catalogue".localized)
            
            Divider()
            
            Button(role: .destructive, action: {
                HapticFeedback.shared.trigger(style: .light)
                
                if viewModel.isAudiobookInPlayer(audiobook) {
                    audiobookIsNowPlayingAlert(audiobook)
                } else {
                    bookDeleteConfirmationAlert(audiobook)
                }
            }) {
                LabeledContent("my_books_delete".localized) {
                    Image(systemName: "trash")
                }
                .tint(.red)
            }
            .trackButtonTap("my_books_delete".localized)
        }
    }
}

extension MyLibraryView {
    private func bookDeleteConfirmationAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_delete_confirm_title".localized,
            alertMessage: String(format: "my_books_delete_confirm_message".localized, audiobook.title),
            alertButtons: [
                .destructive("my_books_delete_confirm_btn".localized) {
                    viewModel.deleteAudiobook(audiobook)
                },
                .cancel("my_books_cancel_btn".localized) {}
            ]
        )
    }
    
    private func audiobookIsDownloadingAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_downloading_title".localized,
            alertMessage: String(format: "my_books_downloading_message".localized, audiobook.title),
            alertButtons: [.default("my_books_ok_btn".localized) {}]
        )
    }
    
    private func voucherIsNotValidAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_invalid_voucher_title".localized,
            alertMessage: String(format: "my_books_invalid_voucher_message".localized, audiobook.title),
            alertButtons: [.default("my_books_ok_btn".localized) {}]
        )
    }
    
    private func graphIsProcessingAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_graph_processing_title".localized,
            alertMessage: String(format: "my_books_graph_processing_message".localized, audiobook.title),
            alertButtons: [.default("my_books_ok_btn".localized) {}]
        )
    }
    
    private func transcribingAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_transcribing_title".localized,
            alertMessage: "my_books_transcribing_message".localized,
            alertButtons: [
                .default("my_books_ok_btn".localized) {}
            ]
        )
    }

    private func speechRecognitionDeniedAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_speech_recognition_title".localized,
            alertMessage: "my_books_speech_recognition_message".localized,
            alertButtons: [
                .default("my_books_settings_btn".localized) {
                    if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(settingsUrl)
                    }
                },
                .cancel(title: "my_books_cancel_btn".localized) {}
            ]
        )
    }
    
    private func audiobookIsNowPlayingAlert(_ audiobook: AudiobookModel) {
        AlertManager.shared.showAlert(
            alertTitle: "my_books_now_playing_title".localized,
            alertMessage: String(format: "my_books_now_playing_message".localized, audiobook.title),
            alertButtons: [.default("my_books_ok_btn".localized) {}]
        )
    }
}
