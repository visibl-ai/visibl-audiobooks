//
//  NowPlayingViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import FirebaseDatabase
import Kingfisher

typealias ChapterData = [[SceneModel]]

final class NowPlayingViewModel: ObservableObject {
    private let player: AudioPlayerManager
    private let userConfig = UserConfigurations.shared
    private let databaseManager = RTDBManager.shared
    private var subscriptions = Set<AnyCancellable>()
    private var observerHandle: DatabaseHandle?
    private var currentSubscribedStyleId: String?
    
    @Published var isPlaying: Bool = false
    @Published var currentTime: Double?
    
    var chapters: ChapterData = [] {
        didSet {
            updateSceneImage()
        }
    }
    
    @Published var imageURL: URL? {
        didSet {
            guard imageURL != oldValue else { return }
            updateArtwork()
        }
    }
    
    @Published var audiobook: AudiobookModel? {
        didSet {
            unsubscribeFromSceneList()
            subscribeToSceneList()
            updateSceneImage()
        }
    }
    
    init(player: AudioPlayerManager) {
        self.player = player
        bind()
    }
    
    deinit {
        unsubscribeFromSceneList()
    }
}

extension NowPlayingViewModel {
    private func bind() {
        player.$audiobook
            .receive(on: DispatchQueue.main)
            .sink { [weak self] audiobook in
                self?.audiobook = audiobook
            }
            .store(in: &subscriptions)
        
        player.$isPlaying
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isPlaying in
                self?.isPlaying = isPlaying
            }
            .store(in: &subscriptions)
        
        player.$currentTime
            .receive(on: DispatchQueue.main)
            .sink { [weak self] currentTime in
                self?.currentTime = currentTime
                self?.updateSceneImage()
            }
            .store(in: &subscriptions)
        
        // Observe changes to currentSceneStyle
        player.$audiobook
            .compactMap { $0?.sceneStyleInfo.currentSceneStyle }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                // Re-subscribe when style changes
                self?.subscribeToSceneList()
                self?.updateSceneImage()
            }
            .store(in: &subscriptions)
    }
}

extension NowPlayingViewModel {
    func play() {
        player.play()
    }
    
    func pause() {
        player.pause()
    }
    
    func playPause() {
        isPlaying ? pause() : play()
    }
    
    func seekBackward() {
        player.seekBackward()
    }
    
    func stopPlayer() {
        player.stop()
        player.currentTime = nil
        imageURL = nil
    }
}

// MARK: - Helper Computed Properties

extension NowPlayingViewModel {
    private var currentChapter: [SceneModel]? {
        guard let audiobook = audiobook,
              audiobook.playbackInfo.currentResourceIndex < chapters.count else {
            return nil
        }
        let chapter = chapters[audiobook.playbackInfo.currentResourceIndex]
        return chapter.isEmpty ? nil : chapter
    }
    
    private var chapterStartOffset: Double? {
        return currentChapter?.first?.startTime
    }
    
    private func toChapterRelativeTime(_ absoluteTime: Double) -> Double? {
        guard let offset = chapterStartOffset else { return nil }
        return absoluteTime - offset
    }
    
    var getCurrentScene: SceneModel? {
        guard let currentTime = currentTime,
              let chapter = currentChapter else {
            return nil
        }

        return chapter.first { scene in
            guard let sceneStart = toChapterRelativeTime(scene.startTime),
                  let sceneEnd = toChapterRelativeTime(scene.endTime) else {
                return false
            }
            return sceneStart <= currentTime && currentTime < sceneEnd
        }
    }
    
    var effectiveStyleId: String? {
        guard let audiobook = audiobook else {
            return nil
        }
        
        if let currentStyle = audiobook.sceneStyleInfo.currentSceneStyle,
           !currentStyle.isEmpty {
            return currentStyle
        }
        
        return audiobook.publication.defaultSceneId
    }
    
    func getSceneImageURLString(for styleId: String?) -> String? {
        guard let scene = getCurrentScene else {
            return nil
        }
        
        // 1. First try: Get image from derived style if styleId is provided
        if let styleId = styleId,
           let derivedScene = scene.derivedScenes?[styleId] {
            return derivedScene.image
        }
        
        // 2. Second try: Use the main scene image
        if let mainImage = scene.image {
            return mainImage
        }
        
        // 3. No image available
        return nil
    }
}

// MARK: - Scene List Subscription

extension NowPlayingViewModel {
    private func subscribeToSceneList() {
        guard let audiobook = audiobook else {
            return
        }
        
        // Always use defaultSceneId for subscription path (that's where scenes are stored)
        guard let styleId = audiobook.publication.defaultSceneId else {
            return
        }
        
        // Don't re-subscribe if already subscribed to the same style
        if currentSubscribedStyleId == styleId {
            return
        }
        
        // Unsubscribe from previous style if needed
        if currentSubscribedStyleId != nil {
            unsubscribeFromSceneList()
        }
        
        currentSubscribedStyleId = styleId
        let path = "scenes/\(styleId)"
        
        observerHandle = databaseManager.observeNormalizedNestedArray(at: path, elementType: SceneModel.self) { [weak self] result in
            switch result {
            case .success(let data):
                DispatchQueue.main.async {
                    self?.chapters = data
                }
            case .failure(let error):
                print("Error: \(error)")
            }
        }
    }
    
    private func unsubscribeFromSceneList() {
        if let handle = observerHandle,
           let styleId = currentSubscribedStyleId {
            let path = "scenes/\(styleId)"
            databaseManager.removeObserver(handle: handle, at: path)
            observerHandle = nil
            currentSubscribedStyleId = nil
        }
    }
    
    private func updateSceneImage() {
        guard audiobook != nil else {
            imageURL = nil
            return
        }
        
        let imageURLString = getSceneImageURLString(for: effectiveStyleId)
        
        if let imageURLString = imageURLString,
           let url = URL(string: imageURLString) {
            imageURL = url
        } else {
            imageURL = nil
        }
    }
}

extension NowPlayingViewModel {
    private func updateArtworkWithCover() async {
        guard let audiobook = audiobook, let url = URL(string: audiobook.coverURL) else { return }
        
        do {
            let result = try await KingfisherManager.shared.retrieveImage(with: url)
            player.updateArtwork(result.image)
        } catch {
            print(error.localizedDescription)
        }
    }
    
    private func updateArtwork() {
        if let imageURL = imageURL {
            if userConfig.displayCarouselOnHomeScreen {
                Task {
                    let image = await ImageDownloadManager.shared.getImage(from: imageURL.absoluteString)
                    
                    if let image = image {
                        player.updateArtwork(image)
                    }
                }
            } else {
                Task {
                    await updateArtworkWithCover()
                }
            }
        }
    }
}
