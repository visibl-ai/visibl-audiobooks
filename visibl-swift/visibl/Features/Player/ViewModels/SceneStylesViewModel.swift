//
//  SceneStylesViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import FirebaseDatabase
import SwiftUI

typealias ChaptersArray = [[SceneModel]]
typealias StylesCollection = [String: StyleModel]

@Observable final class SceneStylesViewModel {
    var audiobook: AudiobookModel
    var currentStyleId: String?
    var currentTimeLowRes: Double?

    private let player: AudioPlayerManager
    private let userLibraryObserver: UserLibraryObserver
    private let sceneDataService = SceneDataService.shared
    private var subscriptions = Set<AnyCancellable>()

    var chapters: ChaptersArray {
        sceneDataService.chapters
    }

    var styles: StylesCollection? { publication?.styles ?? [:] }

    var publication: PublicationModel? { audiobook.publication }

    var sortedStyles: [(key: String, value: StyleModel)] {
        guard let styles = publication?.styles else { return [] }
        return styles.sorted { $0.key < $1.key }
    }

    init(
        audiobook: AudiobookModel,
        player: AudioPlayerManager,
        userLibraryObserver: UserLibraryObserver
    ) {
        self.audiobook = audiobook
        self.player = player
        self.userLibraryObserver = userLibraryObserver
        self.currentTimeLowRes = audiobook.playbackInfo.progressInCurrentResource
        bind()
    }
}

// MARK: - Combine Subscriptions

extension SceneStylesViewModel {
    private func bind() {
        // Standard frequency for scene calculations and progress bar updates
        player.$currentTime
            .receive(on: DispatchQueue.main)
            .sink { [weak self] currentTimeLowRes in
                guard let self = self else { return }
                self.currentTimeLowRes = currentTimeLowRes
            }
            .store(in: &subscriptions)
        
        userLibraryObserver.$audiobooks
            .compactMap { [weak self] audiobooks -> AudiobookModel? in
                guard let id = self?.audiobook.id else { return nil }
                return audiobooks.first { $0.id == id }
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] updated in
                self?.applyUpdatedAudiobook(updated)
            }
            .store(in: &subscriptions)
    }
}

// MARK: - Helper Computed Properties

extension SceneStylesViewModel {
    var currentScene: SceneModel? {
        guard let currentTime = currentTimeLowRes,
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

    var currentSceneIndex: Int? {
        guard let currentScene = currentScene,
              let chapter = currentChapter else { return nil }
        return chapter.firstIndex(where: { $0.sceneNumber == currentScene.sceneNumber })
    }

    var styleIdFromClientData: String {
        if let currentStyle = audiobook.sceneStyleInfo.currentSceneStyle,
           !currentStyle.isEmpty {
            return currentStyle
        }

        return audiobook.publication.defaultSceneId ?? ""
    }

    var currentSceneNumber: String {
        guard let scene = currentScene else { return "--:--" }

        return "#\(scene.sceneNumber + 1)"
    }

    var currentSceneDuration: TimeInterval {
        guard let scene = currentScene else { return 0 }

        if let start = toChapterRelativeTime(scene.startTime),
           let end = toChapterRelativeTime(scene.endTime) {
            return max(end - start, 0)
        }

        return max(scene.endTime - scene.startTime, 0)
    }

    var currentSceneStartTime: TimeInterval? {
        guard let scene = currentScene else { return nil }
        if let start = toChapterRelativeTime(scene.startTime) {
            return start
        }
        return scene.startTime
    }

    var currentSceneIdentifier: String? {
        guard let scene = currentScene else { return nil }
        if let id = scene.sceneId, !id.isEmpty {
            return id
        }
        return "scene-\(scene.sceneNumber)-\(scene.startTime)"
    }

    var currentStyleTitle: String? {
        guard let currentStyleId = currentStyleId,
              let style = styles?[currentStyleId] else {
            return nil
        }

        return style.title
    }

    var isCurrentSceneLoading: Bool {
        guard let scene = currentScene,
              let currentStyleId = currentStyleId
        else { return true }

        let derivedScene = scene.derivedScenes?[currentStyleId]

        if derivedScene?.id == currentStyleId {
            return false
        }

        return true
    }

    private var currentChapter: [SceneModel]? {
        let chapter = sceneDataService.currentChapterScenes
        return chapter.isEmpty ? nil : chapter
    }

    private var chapterStartOffset: Double? {
        return currentChapter?.first?.startTime
    }

    private func toChapterRelativeTime(_ absoluteTime: Double) -> Double? {
        guard let offset = chapterStartOffset else { return nil }
        return absoluteTime - offset
    }
}

// MARK: - Helper Function to Get Image

extension SceneStylesViewModel {
    func getSceneImageURLString(for styleId: String?) -> String? {
        guard let scene = currentScene else {
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



// MARK: - Current Style Update Logic

extension SceneStylesViewModel {
    func updateCurrentStyle(_ newStyleId: String?) {
        guard let newStyleId = newStyleId, !newStyleId.isEmpty else {
            return
        }

        print("newStyleId \(newStyleId)")

        currentStyleId = newStyleId
        audiobook.updateCurrentSceneStyle(styleId: newStyleId)
        audiobook.updateCarouselIDs(carouselIDs: getStyleCarouselIDs())
    }

    func getStyleCarouselIDs() -> String {
        guard let styles = styles,
              let currentStyle = audiobook.sceneStyleInfo.currentSceneStyle else {
            return ""
        }

        let stylesArray = Array(styles.keys).sorted()
        guard let styleIndex = stylesArray.firstIndex(of: currentStyle),
              !stylesArray.isEmpty else {
            return ""
        }

        // Get up to 3 styles centered around current style
        let carouselSize = 3
        let uniqueCount = min(carouselSize, stylesArray.count)
        let startOffset = -(uniqueCount / 2)

        var ids = (0..<uniqueCount).map { i in
            let idx = (styleIndex + startOffset + i + stylesArray.count) % stylesArray.count
            return stylesArray[idx]
        }

        // Ensure origin ID is always included
        if let originId = audiobook.publication.defaultSceneId,
           !ids.contains(originId) {
            if ids.count < carouselSize {
                ids.append(originId)
            } else if let indexToReplace = ids.firstIndex(where: { $0 != currentStyle }) {
                ids[indexToReplace] = originId
            }
        }

        return ids.joined(separator: ",")
    }
}

// MARK: - Navigation Through Scenes

extension SceneStylesViewModel {
    func nextScene() {
        guard let currentScene = currentScene,
              let chapter = currentChapter else { return }

        // Find the next scene after the current one
        guard let nextScene = chapter.first(where: { $0.startTime > currentScene.startTime }),
              let chapterRelativeTime = toChapterRelativeTime(nextScene.startTime) else { return }

        player.seek(to: chapterRelativeTime + 0.1)
    }

    func previousScene() {
        guard let currentScene = currentScene,
              let chapter = currentChapter else { return }

        // Find the previous scene or stay at current if it's the first
        let previousScene = chapter.last(where: { $0.startTime < currentScene.startTime }) ?? currentScene

        guard let chapterRelativeTime = toChapterRelativeTime(previousScene.startTime) else { return }
        player.seek(to: chapterRelativeTime + 0.1)
    }
}

extension SceneStylesViewModel {
    func prefetchSceneImages() {
        let audiobook = self.audiobook
        let chapters = self.chapters

        DispatchQueue.global(qos: .userInitiated).async {
            ImagePrefetchManager.shared.preloadImagesIfPossible(
                audiobook: audiobook,
                chapterData: chapters
            )
        }
    }
}

// MARK: - Audiobook Updates

private extension SceneStylesViewModel {
    func applyUpdatedAudiobook(_ updated: AudiobookModel) {
        // Only override chapter index if service has active subscription
        // Otherwise trust incoming data (e.g., fresh launch before setupPlayer is called)
        if sceneDataService.hasActiveSubscription {
            let localChapterIndex = sceneDataService.currentChapterIndex
            if updated.playbackInfo.currentResourceIndex != localChapterIndex {
                updated.userLibraryItem.clientData.playbackInfo.currentResourceIndex = localChapterIndex
            }
        }
        audiobook = updated
    }
}
