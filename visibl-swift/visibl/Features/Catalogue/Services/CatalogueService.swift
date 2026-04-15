//
//  CatalogueService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import FirebaseAuth
import FirebaseDatabase

actor CatalogueService {
    static let shared = CatalogueService()

    private let databaseRef = FirebaseContainer.shared.db
    private let pageSize = 20
    private let uploadedPrefix = "CSTM_"

    private var publicIds: [String] = []
    private var privateIds: [String] = []
    private var uploadedIds: [String] = []
    private var publicationsCache: [String: PublicationPreviewModel] = [:]
    private var publicFetchTask: Task<Void, Error>?
    private var importedFetchTask: Task<Void, Error>?

    private init() {}

    // MARK: - Public API

    func fetchPublicPublicationIds() async throws -> [String] {
        try await fetchPublicPublicationsIfNeeded()
        return publicIds
    }

    private func fetchPublicPublicationsIfNeeded() async throws {
        // If already fetched, return immediately
        if !publicIds.isEmpty {
            return
        }

        // If a fetch is in progress, wait for it
        if let existingTask = publicFetchTask {
            try await existingTask.value
            return
        }

        // Start a new fetch task
        let task = Task<Void, Error> { [weak self] in
            guard let self else { return }

            let snapshot = try await databaseRef.child("catalogue").getDataAsync()

            guard let dict = snapshot.value as? [String: Any] else {
                return
            }

            var newIds: [String] = []
            var newCache: [String: PublicationPreviewModel] = [:]
            for (id, value) in dict {
                if let pub = self.decode(value) {
                    newCache[id] = pub
                    if pub.visability == .public {
                        newIds.append(id)
                    }
                }
            }

            await self.mergePublicResults(ids: newIds.sorted(), cache: newCache)
        }

        publicFetchTask = task
        defer { publicFetchTask = nil }

        try await task.value
    }

    private func mergePublicResults(ids: [String], cache: [String: PublicationPreviewModel]) {
        publicIds = ids
        for (key, value) in cache {
            publicationsCache[key] = value
        }
    }

    func fetchPrivatePublicationIds() async throws -> [String] {
        try await fetchImportedPublicationsIfNeeded()
        return privateIds
    }

    func fetchUploadedPublicationIds() async throws -> [String] {
        try await fetchImportedPublicationsIfNeeded()
        return uploadedIds
    }

    /// Fetches all imported SKUs and splits them into private (AAX) and uploaded arrays.
    /// Uses a shared task to prevent duplicate fetches when called concurrently.
    private func fetchImportedPublicationsIfNeeded() async throws {
        // If already fetched, return immediately
        if !privateIds.isEmpty || !uploadedIds.isEmpty {
            return
        }

        // If a fetch is in progress, wait for it
        if let existingTask = importedFetchTask {
            try await existingTask.value
            return
        }

        // Start a new fetch task
        let task = Task<Void, Error> { [weak self] in
            guard let self else { return }

            guard let userId = Auth.auth().currentUser?.uid else {
                return
            }

            let snapshot = try await databaseRef.child("users/\(userId)/importedSkus").getDataAsync()

            // Firebase may return array as [String] or dictionary as [String: Any]
            let skus: [String]
            if let array = snapshot.value as? [String] {
                skus = array
            } else if let dict = snapshot.value as? [String: Any] {
                skus = Array(dict.keys)
            } else {
                return
            }

            let allIds = skus.sorted()

            // Fetch any missing publication data
            var newCache: [String: PublicationPreviewModel] = [:]
            for id in allIds {
                let isCached = await self.hasCachedPublication(id: id)
                if !isCached {
                    let pubSnapshot = try await self.databaseRef.child("catalogue/\(id)").getDataAsync()
                    if let value = pubSnapshot.value, let pub = self.decode(value) {
                        newCache[id] = pub
                    }
                }
            }

            await self.mergeImportedResults(allIds: allIds, cache: newCache)
        }

        importedFetchTask = task
        defer { importedFetchTask = nil }

        try await task.value
    }

    private func hasCachedPublication(id: String) -> Bool {
        publicationsCache[id] != nil
    }

    private func mergeImportedResults(allIds: [String], cache: [String: PublicationPreviewModel]) {
        for (key, value) in cache {
            publicationsCache[key] = value
        }

        // Split into private (AAX) and uploaded
        privateIds = allIds.filter { !$0.hasPrefix(uploadedPrefix) }
        uploadedIds = allIds.filter { $0.hasPrefix(uploadedPrefix) }
    }

    func fetchPublications(for sourceType: SourceType, page: Int) -> [PublicationPreviewModel] {
        let ids: [String]
        switch sourceType {
        case .visibl:
            ids = publicIds
        case .aax:
            ids = privateIds
        case .uploaded:
            ids = uploadedIds
        }

        let start = page * pageSize
        let end = min(start + pageSize, ids.count)

        guard start < ids.count else { return [] }

        return ids[start..<end].compactMap { publicationsCache[$0] }
    }

    func hasMore(for sourceType: SourceType, loadedCount: Int) -> Bool {
        switch sourceType {
        case .visibl:
            return loadedCount < publicIds.count
        case .aax:
            return loadedCount < privateIds.count
        case .uploaded:
            return loadedCount < uploadedIds.count
        }
    }

    func reset(for sourceType: SourceType) {
        switch sourceType {
        case .visibl:
            // Clear cached publications for public IDs
            for id in publicIds {
                publicationsCache.removeValue(forKey: id)
            }
            publicIds = []
            publicFetchTask = nil
        case .aax, .uploaded:
            // Both aax and uploaded share the same fetch, so reset both
            // Clear cached publications for private and uploaded IDs
            for id in privateIds {
                publicationsCache.removeValue(forKey: id)
            }
            for id in uploadedIds {
                publicationsCache.removeValue(forKey: id)
            }
            privateIds = []
            uploadedIds = []
            importedFetchTask = nil
        }
    }

    func resetAll() {
        publicIds = []
        privateIds = []
        uploadedIds = []
        publicationsCache = [:]
        publicFetchTask = nil
        importedFetchTask = nil
    }

    // MARK: - Private

    private nonisolated func decode(_ value: Any) -> PublicationPreviewModel? {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let pub = try? JSONDecoder().decode(PublicationPreviewModel.self, from: data) else {
            return nil
        }
        return pub
    }
}

// MARK: - Firebase Async Helper

private extension DatabaseReference {
    func getDataAsync() async throws -> DataSnapshot {
        try await withCheckedThrowingContinuation { continuation in
            getData { error, snapshot in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let snapshot = snapshot {
                    continuation.resume(returning: snapshot)
                } else {
                    continuation.resume(throwing: NSError(domain: "FirebaseDatabase", code: -1, userInfo: [NSLocalizedDescriptionKey: "No snapshot returned"]))
                }
            }
        }
    }
}
