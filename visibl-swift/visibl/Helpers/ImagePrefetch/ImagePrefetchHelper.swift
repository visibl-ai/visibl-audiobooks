//
//  ImagePrefetchHelper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Kingfisher

struct ImagePrefetchHelper {
    // MARK: - Public API

    static func prefetchImages(
        urls: [String],
        batchSize: Int = 7,
        priority: Float = 0.5
    ) {
        let urlObjects = urls.compactMap(URL.init(string:))
        guard !urlObjects.isEmpty else { return }

        let batches = batched(urlObjects, size: max(1, batchSize))
        startPrefetch(batches: batches, priority: priority)
    }

    static func prefetchImage(url: String, priority: Float = 0.5) {
        prefetchImages(urls: [url], batchSize: 1, priority: priority)
    }

    // Backward compatibility
    static func prefetchSceneImages(from scenes: [SceneModel], batchSize: Int = 7) {
        let urls = scenes.compactMap { $0.image }
        prefetchImages(urls: urls, batchSize: batchSize)
    }

    // MARK: - Private helpers

    private static func batched<T>(_ items: [T], size: Int) -> [[T]] {
        guard size > 0, !items.isEmpty else { return [] }
        return stride(from: 0, to: items.count, by: size).map { idx in
            Array(items[idx..<min(idx + size, items.count)])
        }
    }

    private static func startPrefetch(
        batches: [[URL]],
        priority: Float,
        index: Int = 0,
        totalSkipped: Int = 0,
        totalCompleted: Int = 0,
        totalFailed: Int = 0
    ) {
        guard index < batches.count else {
            // Print final summary only if there were any images
            // let total = totalSkipped + totalCompleted + totalFailed
            // if total > 0 { print("🖼️ [Prefetch] Total \(total): ✅ \(totalCompleted) new, ⏭️  \(totalSkipped) cached, ❌ \(totalFailed) failed") }
            return
        }

        let currentBatch = batches[index]

        let prefetcher = ImagePrefetcher(
            urls: currentBatch,
            options: [
                .downloadPriority(priority),
                .cacheOriginalImage
            ],
            completionHandler: { skippedResources, failedResources, completedResources in
                startPrefetch(
                    batches: batches,
                    priority: priority,
                    index: index + 1,
                    totalSkipped: totalSkipped + skippedResources.count,
                    totalCompleted: totalCompleted + completedResources.count,
                    totalFailed: totalFailed + failedResources.count
                )
            }
        )
        prefetcher.start()
    }
}
