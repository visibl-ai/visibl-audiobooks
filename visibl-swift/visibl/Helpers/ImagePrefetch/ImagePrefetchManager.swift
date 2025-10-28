//
//  ImagePrefetchManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class ImagePrefetchManager {
    static let shared = ImagePrefetchManager()

    func getCarousel(audiobook: AudiobookModel) -> [String] {
        guard
            let styles = audiobook.publication.styles?.keys.sorted(),
            !styles.isEmpty,
            let current = audiobook.sceneStyleInfo.currentSceneStyle,
            let currentIndex = styles.firstIndex(of: current)
        else { return [] }

        let count = styles.count
        return (-2...2).map { styles[(currentIndex + $0 + count) % count] }
    }

    func preloadImagesIfPossible(
        audiobook: AudiobookModel,
        chapterData: ChaptersArray
    ) {
        guard !chapterData.isEmpty else { return }

        let styleIds = getCarousel(audiobook: audiobook)
        guard !styleIds.isEmpty else { return }

        let chapterIndex = audiobook.playbackInfo.currentResourceIndex
        guard chapterIndex >= 0, chapterIndex < chapterData.count else { return }

        let chapter = chapterData[chapterIndex]
        guard !chapter.isEmpty else { return }

        let chapterStart = chapter.first?.startTime ?? 0
        let totalProgress = audiobook.playbackInfo.totalProgress
        let relativeTime = max(0, totalProgress - chapterStart)

        guard let currentSceneIndex = currentSceneIndex(in: chapter, at: relativeTime) else {
            // If we can't find the current scene, try to use the first scene
            if !chapter.isEmpty {
                let radius = 2
                let window = windowScenes(around: 0, in: chapter, radius: radius)
                prefetchWindowScenes(window: window, chapter: chapter, styleIds: styleIds, baseIndex: 0)
            }
            return
        }

        let radius = 2
        let window = windowScenes(around: currentSceneIndex, in: chapter, radius: radius)

        // Single summary log
        let sceneNumbers = window.map { String($0.sceneNumber) }.joined(separator: ", ")
        // print("🎨 [Prefetch] Ch\(chapterIndex) Scene\(currentSceneIndex): scenes [\(sceneNumbers)]")

        prefetchWindowScenes(window: window, chapter: chapter, styleIds: styleIds, baseIndex: currentSceneIndex)
    }

    // MARK: - Helpers

    private func prefetchWindowScenes(window: [SceneModel], chapter: [SceneModel], styleIds: [String], baseIndex: Int) {
        // Prioritize by proximity to current scene and prefetch per priority tier
        let sorted = window.sorted { lhs, rhs in
            let li = index(of: lhs, in: chapter)
            let ri = index(of: rhs, in: chapter)
            return abs(li - baseIndex) < abs(ri - baseIndex)
        }

        var allUrls: [String] = []
        for (offset, scene) in sorted.enumerated() {
            let priority = Float(1.0 - (Float(offset) * 0.2))
            let urls = styleIds.compactMap { style in scene.derivedScenes?[style]?.image }
            guard !urls.isEmpty else { continue }

            allUrls.append(contentsOf: urls)

            ImagePrefetchHelper.prefetchImages(
                urls: urls,
                batchSize: 7,
                priority: priority
            )
        }

        // No need for this log anymore, ImagePrefetchHelper will print summary
    }

    private func currentSceneIndex(in chapter: [SceneModel], at time: Double) -> Int? {
        chapter.firstIndex { scene in
            let start = scene.startTime - (chapter.first?.startTime ?? 0)
            let end = scene.endTime - (chapter.first?.startTime ?? 0)
            return start <= time && time < end
        }
    }

    private func windowScenes(around index: Int, in chapter: [SceneModel], radius: Int) -> [SceneModel] {
        guard !chapter.isEmpty else { return [] }
        let start = max(0, index - radius)
        let end = min(chapter.count - 1, index + radius)
        return Array(chapter[start...end])
    }

    private func index(of scene: SceneModel, in chapter: [SceneModel]) -> Int {
        chapter.firstIndex { $0.sceneNumber == scene.sceneNumber } ?? 0
    }
}
