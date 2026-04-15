////
////  AAXCatalogueManager.swift
////  visibl
////
////  Copyright (c) 2025 Visibl Holdings Limited
////
//
//import Foundation
//import FirebaseDatabase
//import FirebaseAuth
//
//final class AAXCatalogueManager {
//    private let databaseManager = RTDBManager.shared
//    private let pageSize = 20
//
//    // Cache all publication IDs for the current user
//    private var allPublicationIds: [String] = []
//    private var currentUserID: String?
//
//    /// Fetch all AAX publication IDs for the current user (from importedSkus)
//    func fetchAllPublicationIds() async throws -> [String] {
//        guard let userID = Auth.auth().currentUser?.uid else {
//            throw DatabaseError.unauthorized
//        }
//
//        let path = "users/\(userID)/importedSkus"
//        let ref = databaseManager.databaseRef.child(path)
//
//        let snapshot = try await databaseManager.fetchSnapshot(from: ref)
//
//        guard snapshot.exists(), let skus = snapshot.value as? [String] else {
//            // No imported SKUs
//            self.allPublicationIds = []
//            self.currentUserID = userID
//            return []
//        }
//
//        self.allPublicationIds = skus
//        self.currentUserID = userID
//        return skus
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
//    /// Reset the cached IDs (for refresh or user change)
//    func reset() {
//        allPublicationIds = []
//        currentUserID = nil
//    }
//}
