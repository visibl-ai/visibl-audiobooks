//
//  SceneDataService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase

@Observable
final class SceneDataService {
    static let shared = SceneDataService()

    private(set) var chapters: [[SceneModel]] = []

    /// The currently subscribed chapter index - use this as the source of truth
    private(set) var currentChapterIndex: Int = 0

    /// Whether the service has an active subscription (use to guard against stale defaults)
    var hasActiveSubscription: Bool { observerHandle != nil }

    /// Convenience: scenes for the current chapter
    var currentChapterScenes: [SceneModel] {
        guard currentChapterIndex < chapters.count else { return [] }
        return chapters[currentChapterIndex]
    }

    @ObservationIgnored private let databaseManager = RTDBManager.shared
    @ObservationIgnored private var observerHandle: DatabaseHandle?
    @ObservationIgnored private var subscribedStyleId: String?

    private init() {}

    // MARK: - Public API

    /// Subscribe to a specific audiobook and chapter.
    /// Call this when the player loads a new audiobook or changes chapters.
    func subscribeToAudiobook(_ audiobook: AudiobookModel?) {
        guard let audiobook = audiobook,
              let styleId = audiobook.publication.defaultSceneId else {
            // print("🔌 [SceneDataService] No audiobook or style, unsubscribing")
            unsubscribe()
            return
        }

        let chapterIndex = audiobook.playbackInfo.currentResourceIndex
        // print("📖 [SceneDataService] Subscribe request: chapter \(chapterIndex)")
        subscribe(styleId: styleId, chapterIndex: chapterIndex)
    }

    func clear() {
        unsubscribe()
        subscribedStyleId = nil
        currentChapterIndex = 0
        chapters = []
    }

    // MARK: - Private

    private func subscribe(styleId: String, chapterIndex: Int) {
        // Skip if already subscribed to same style and chapter
        if subscribedStyleId == styleId && currentChapterIndex == chapterIndex && observerHandle != nil {
            // print("⏭️ [SceneDataService] Already subscribed to chapter \(chapterIndex), skipping")
            return
        }

        // Clear chapters when style or chapter changes to avoid showing stale data
        if subscribedStyleId != styleId || currentChapterIndex != chapterIndex {
            // print("🔄 [SceneDataService] Style or chapter changed, clearing chapters")
            chapters = []
        }

        unsubscribe()

        subscribedStyleId = styleId
        currentChapterIndex = chapterIndex
        let path = "scenes/\(styleId)/\(chapterIndex)"
        // print("📡 [SceneDataService] Subscribing to chapter \(chapterIndex) at path: \(path)")

        observerHandle = databaseManager.observeNormalizedArray(at: path, elementType: SceneModel.self) { [weak self] result in
            switch result {
            case .success(let scenes):
                // print("✅ [SceneDataService] Received \(scenes.count) scenes for chapter \(chapterIndex)")
                DispatchQueue.main.async {
                    self?.updateChapter(at: chapterIndex, with: scenes)
                }
            case .failure(let error):
                print("❌ [SceneDataService] Error loading chapter \(chapterIndex): \(error)")
            }
        }
    }

    private func unsubscribe() {
        if let handle = observerHandle,
           let styleId = subscribedStyleId {
            let path = "scenes/\(styleId)/\(currentChapterIndex)"
            // print("🔌 [SceneDataService] Unsubscribing from chapter \(currentChapterIndex) at path: \(path)")
            databaseManager.removeObserver(handle: handle, at: path)
        }
        observerHandle = nil
    }

    private func updateChapter(at index: Int, with scenes: [SceneModel]) {
        while chapters.count <= index {
            chapters.append([])
        }
        chapters[index] = scenes
    }
}
