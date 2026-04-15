////
////  CatalogueManager.swift
////  visibl
////
////  Copyright (c) 2025 Visibl Holdings Limited
////
//
//import Foundation
//import FirebaseDatabase
//
//final class CatalogueManager {
//    private let databaseManager = RTDBManager.shared
//    private let pageSize = 20
//
//    // Cache all publication IDs
//    private var allPublicationIds: [String] = []
//
//    /// Fetch all publication IDs (lightweight - just keys)
//    func fetchAllPublicationIds() async throws -> [String] {
//        let dbRef = databaseManager.databaseRef.child(ObservationDataPath.catalogue.path)
//        let query = dbRef.queryOrdered(byChild: "visibility").queryEqual(toValue: "public")
//
//        let ids = try await databaseManager.fetchAllChildKeys(from: query)
//        self.allPublicationIds = ids
//
//        return ids
//    }
//
//    /// Fetch publications for a specific page
//    func fetchPublications(page: Int) async throws -> [PublicationModel] {
//        let startIndex = page * pageSize
//        let endIndex = min(startIndex + pageSize, allPublicationIds.count)
//
//        guard startIndex < allPublicationIds.count else {
//            return [] // No more data
//        }
//
//        let pageIds = Array(allPublicationIds[startIndex..<endIndex])
//        let basePath = ObservationDataPath.catalogue.path
//
//        return try await databaseManager.fetchPublications(keys: pageIds, at: basePath)
//    }
//
//    /// Get total number of publications
//    func getTotalCount() -> Int {
//        return allPublicationIds.count
//    }
//
//    /// Check if there are more publications to load
//    func hasMore(loadedCount: Int) -> Bool {
//        return loadedCount < allPublicationIds.count
//    }
//
//    /// Reset the cached IDs (for refresh)
//    func reset() {
//        allPublicationIds = []
//    }
//}
