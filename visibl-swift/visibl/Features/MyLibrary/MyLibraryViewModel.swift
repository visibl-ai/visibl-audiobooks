//
//  MyLibraryViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Combine
import FirebaseAuth
import AAXCPlayer

@MainActor
final class MyLibraryViewModel: ObservableObject {
    private let catalogueObserver: CatalogueObserver
    private let userLibraryObserver: UserLibraryObserver
    private let aaxCatalogueObserver: AAXCatalogueObserver
    private let player: AudioPlayerManager
    private let aaxClient: AAXClientWrapper
    private let rtdbManager = RTDBManager.shared
    private var cancellables = Set<AnyCancellable>()
    private let aaxPipeline: AAXPipeline
    
    var audiobooks: [AudiobookModel] { _audiobooks }
    
    @Published private var _audiobooks: [AudiobookModel] = []
    @Published var selectedFilter: MyLibraryFilterOption = .all
    @Published var isLoading: Bool = true
    @Published var isAAXConnected: Bool = false
    @Published var isRecogizerReady: Bool = false
    @Published var isDownloadingAnyBook: Bool = false
    @AppStorage("selectedSorting") var selectedSorting: MyLibrarySortingOption = .creationDate
    @AppStorage("selectedLayout") var selectedLayout: MyLibraryLayoutOption = .grid
        
    var displayedAudiobooks: [AudiobookModel] {
        let filteredAudiobooks: [AudiobookModel]
        
        switch selectedFilter {
        case .all:
            filteredAudiobooks = audiobooks.filter { !$0.isArchived }
        case .finished:
            filteredAudiobooks = audiobooks.filter { $0.isFinished && !$0.isArchived }
        case .listeningNow:
            filteredAudiobooks = audiobooks.filter { $0.isInProgress && !$0.isArchived }
        case .isFavorite:
            filteredAudiobooks = audiobooks.filter { $0.isFavourite && !$0.isArchived }
        case .archived:
            filteredAudiobooks = audiobooks.filter { $0.isArchived }
        }
        
        switch selectedSorting {
        case .creationDate:
            return filteredAudiobooks.sorted { $0.addedDate > $1.addedDate }
        case .title:
            return filteredAudiobooks.sorted { $0.title < $1.title }
        case .author:
            return filteredAudiobooks.sorted {
                let lhsAuthor = $0.authors.first ?? ""
                let rhsAuthor = $1.authors.first ?? ""
                return lhsAuthor < rhsAuthor
            }
        }
    }

    init(
        catalogueObserver: CatalogueObserver,
        userLibraryObserver: UserLibraryObserver,
        aaxCatalogueObserver: AAXCatalogueObserver,
        player: AudioPlayerManager,
        aaxClient: AAXClientWrapper,
        aaxPipeline: AAXPipeline
    ) {
        self.catalogueObserver = catalogueObserver
        self.userLibraryObserver = userLibraryObserver
        self.aaxCatalogueObserver = aaxCatalogueObserver
        self.player = player
        self.aaxClient = aaxClient
        self.aaxPipeline = aaxPipeline
        bind()
        updateAudiobooks()

        // Set up callback for download state changes
        aaxPipeline.onDownloadStateChanged = { [weak self] isDownloading in
            self?.isDownloadingAnyBook = isDownloading
        }

        // Set up callback for getting audiobook by ID
        aaxPipeline.getAudiobook = { [weak self] audiobookId in
            self?._audiobooks.first { $0.id == audiobookId }
        }
    }
}

extension MyLibraryViewModel {
    private func bind() {
        catalogueObserver.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateAudiobooks()
            }
            .store(in: &cancellables)
        
        userLibraryObserver.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateAudiobooks()
            }
            .store(in: &cancellables)
        
        aaxCatalogueObserver.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateAudiobooks()
            }
            .store(in: &cancellables)
        
        userLibraryObserver.$isLoading
            .sink(receiveValue: { [weak self] isLoading in
                self?.isLoading = isLoading
            })
            .store(in: &cancellables)
        
        aaxClient.$isAuthenticated
            .sink(receiveValue: { [weak self] isAuthenticated in
                self?.isAAXConnected = isAuthenticated
            })
            .store(in: &cancellables)

//        speechWrapper.$isRecognizerReady
//            .sink(receiveValue: { [weak self] isReady in
//                self?.isRecogizerReady = isReady
//            })
//            .store(in: &cancellables)

    }
    
    private func updateAudiobooks() {
        // let previousCount = _audiobooks.count
        let previousIDs = Set(_audiobooks.map { $0.id })
        
        _audiobooks = AudiobookModel.composeAudiobooks(
            from: aaxCatalogueObserver.publications,
            and: userLibraryObserver.libraryItems
        ) + AudiobookModel.composeAudiobooks(
            from: catalogueObserver.publications,
            and: userLibraryObserver.libraryItems
        )
        
        // let newCount = _audiobooks.count
        let currentIDs = Set(_audiobooks.map { $0.id })
        let addedIDs = currentIDs.subtracting(previousIDs)
        
        if !addedIDs.isEmpty {
            // print("📚 New books added: \(addedIDs)")
            // Handle new book logic here - maybe show a notification?
            for id in addedIDs {
                if let newBook = _audiobooks.first(where: { $0.id == id }) {
                    print("New book: \(newBook.title)")
                    // ImagePrefetchManager.shared.cacheArtworks(audiobook: newBook)
                    // setCarouselList(newBook)
                }
            }
        }

        for audiobook in _audiobooks {
            setCarouselList(audiobook)
        }

        // print("updateAudiobooks triggered - books: \(previousCount) → \(newCount)")
    }
}

// MARK: - Audiobooks CRUD

extension MyLibraryViewModel {
    @MainActor func deleteAudiobook(_ audiobook: AudiobookModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }

        let path = "users/\(userID)/library/\(audiobook.id)"

        if audiobook.isAAX {
            deleteDownloadedFile(audiobook)
            aaxPipeline.cancelProcessingForAudiobook(audiobookId: audiobook.id)
        }

        Task { @MainActor in
            try await rtdbManager.deleteData(at: path)
            Toastify.show(style: .success, message: "\(audiobook.title) deleted successfully")
        }
    }
    
    private func deleteDownloadedFile(_ audiobook: AudiobookModel) {
        FileManager.default.deleteFileIfExists(at: audiobook.aaxFileURL)
        FileManager.default.deleteFileIfExists(at: audiobook.convertedAAXFileURL)
    }
    
    func toggleFavorite(_ audiobook: AudiobookModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let path = "users/\(userID)/library/\(audiobook.id)/clientData/isFavourite"
        rtdbManager.writeData(to: path, value: audiobook.isFavourite ? false : true)
    }
    
    func markAsFinished(_ audiobook: AudiobookModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let flagPath = "users/\(userID)/library/\(audiobook.id)/clientData/isFinished"
        let playbackInfoPath = "users/\(userID)/library/\(audiobook.id)/clientData/playbackInfo"
        rtdbManager.writeData(to: flagPath, value: audiobook.isFinished ? false : true)
        
        let playbackInfo = PlaybackInfoModel(
            currentResourceIndex: audiobook.isFinished ? 0 : audiobook.readingOrder.count - 1,
            progressInCurrentResource: 0.0,
            totalProgress: audiobook.isFinished ? 0.0 : audiobook.duration
        )
        
        rtdbManager.writeData(to: playbackInfoPath, value: playbackInfo)
    }
    
    func moveToArchive(_ audiobook: AudiobookModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let path = "users/\(userID)/library/\(audiobook.id)/clientData/isArchived"
        rtdbManager.writeData(to: path, value: audiobook.isArchived ? false : true)
    }
    
    func resetProgress(_ audiobook: AudiobookModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let flagPath = "users/\(userID)/library/\(audiobook.id)/clientData/isFinished"
        let playbackInfoPath = "users/\(userID)/library/\(audiobook.id)/clientData/playbackInfo"
        rtdbManager.writeData(to: flagPath, value: false)
        
        let playbackInfo = PlaybackInfoModel(
            currentResourceIndex: 0,
            progressInCurrentResource: 0.0,
            totalProgress: 0.1
        )
        
        rtdbManager.writeData(to: playbackInfoPath, value: playbackInfo)
    }
}

// MARK: - AAX Logic

extension MyLibraryViewModel {
    @MainActor func processAAXFile(_ audiobook: AudiobookModel) async {
        await aaxPipeline.startProcessing(audiobook)
    }
    
    func restartDownload(_ audiobook: AudiobookModel) {
        Task { @MainActor in
            await processAAXFile(audiobook)
        }
    }
    
    func validateAndUpdateVoucher(_ audiobook: AudiobookModel) async {
        if !audiobook.isAAX {
            updateVoucherValidity(for: audiobook.id, isValid: true)
            return
        }
        
        do {
            let isValid = try await aaxClient.validateVoucher(id: audiobook.id)
            print("✅ Voucher is valid for book \(audiobook.title)")
            updateVoucherValidity(for: audiobook.id, isValid: isValid)
        } catch {
            print("Error validating voucher: \(error.localizedDescription)")
            updateVoucherValidity(for: audiobook.id, isValid: false)
        }
    }
    
    private func updateVoucherValidity(for audiobookId: String, isValid: Bool) {
        if let index = audiobooks.firstIndex(where: { $0.id == audiobookId }) {
            audiobooks[index].isVoucherValid = isValid
        }
    }
}

// MARK: - Helper Functions

extension MyLibraryViewModel {
    func isAudiobookInPlayer(_ audiobook: AudiobookModel) -> Bool {
        player.audiobook?.id == audiobook.id
    }
}

extension MyLibraryViewModel {
    func isDownloading(_ audiobook: AudiobookModel) -> Bool {
        // Check if there's any ACTIVE task for this audiobook (downloading, converting, or uploading)
        // Only consider tasks that are actually processing, not waiting
        aaxPipeline.tasks.contains { task in
            task.audiobookId == audiobook.id && task.status.isActive
        }
    }
}

extension MyLibraryViewModel {
    func isGraphReady(_ audiobook: AudiobookModel) -> Bool {
        audiobook.publication.graphProgress?.progress == 100
    }
}

extension MyLibraryViewModel {
//    func setCarouselList(_ audiobook: AudiobookModel) {
//        // 1. Proceed further only if sceneInfo is nil
//        guard audiobook.userLibraryItem.clientData.sceneInfo == nil else { return }
//        // 2. Check if defaultSceneId is available
//        guard let defaultSceneId = audiobook.publication.defaultSceneId else { return }
//        // 3. Check if styles are available
//        guard let styles = audiobook.publication.styles else { return }
//        let stylesArray = Array(styles.keys).sorted()
//        // 4. Get defaultSceneId index in styles array
//        guard let styleIndex = stylesArray.firstIndex(of: defaultSceneId) else { return }
//
//        let count = stylesArray.count
//        guard count > 0 else { return }
//        
//        let offsets = (-2...2)
//        let ids = offsets.map { offset -> String in
//            let idx = (styleIndex + offset + count) % count
//            return stylesArray[idx]
//        }
//        
//        let newIDs = ids.joined(separator: ",")
//        audiobook.updateCurrentSceneStyle(styleId: defaultSceneId)
//        audiobook.updateCarouselIDs(carouselIDs: newIDs)
//    }
    
    func setCarouselList(_ audiobook: AudiobookModel) {
        guard audiobook.userLibraryItem.clientData.sceneInfo == nil,
              let defaultId = audiobook.publication.defaultSceneId,
              let styles = audiobook.publication.styles?.keys.sorted(),
              let index = styles.firstIndex(of: defaultId) else { return }
        
        // If there are fewer than 5 unique styles, this prevents duplicates
        let uniqueCount = min(5, styles.count)
        let ids = (0..<uniqueCount).map { styles[(index + $0 - 2 + styles.count) % styles.count] }
        
        audiobook.updateCurrentSceneStyle(styleId: defaultId)
        audiobook.updateCarouselIDs(carouselIDs: ids.joined(separator: ","))
    }
}
