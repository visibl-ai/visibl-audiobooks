//
//  UserLibraryObserver.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase
import FirebaseAuth
import SwiftUI

final class UserLibraryObserver: ObservableObject {

    // MARK: - Published Properties

    @Published var libraryItems: [UserLibraryItemModel] = []
    @Published private(set) var publications: [PublicationModel] = []
    @Published private(set) var audiobooks: [AudiobookModel] = []
    @Published var isLoading: Bool = true

    // MARK: - Private Properties

    private let databaseManager = RTDBManager.shared
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var currentUserID: String?

    // Library item tracking
    private var hasLoadedInitialData = false

    // Publication tracking
    private var publicationHandles: [String: DatabaseHandle] = [:]
    private var publicationByID: [String: PublicationModel] = [:]

    // Initial load synchronization
    private var initialLibraryItemIDs: Set<String> = []
    private var loadedInitialPublicationIDs: Set<String> = []
    private var isWaitingForInitialPublications = false

    // MARK: - Constants

    private enum Timing {
        static let batchingDelay: TimeInterval = 0.3
        static let publicationTimeout: TimeInterval = 3.3
        static let emptyLibraryTimeout: TimeInterval = 2.0
        static let loadingAnimationDuration: TimeInterval = 0.5
        static let removeAnimationDuration: TimeInterval = 0.25
    }

    private enum Path {
        static let catalogue = "catalogue/"
        static func userLibrary(userID: String) -> String { "users/\(userID)/library" }
    }

    // MARK: - Initialization

    init() {
        subscribeToAuthState()
        print("UserLibraryObserver is initialized")
    }

    deinit {
        cleanupAllObservers()
    }
}

// MARK: - Auth State Observation

private extension UserLibraryObserver {
    func subscribeToAuthState() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            guard let self else { return }

            if currentUserID != nil {
                handleUserSignedOut()
            }

            if let user {
                currentUserID = user.uid
                subscribeToUserLibrary(userID: user.uid)
            } else {
                finishLoading()
            }
        }
    }

    func handleUserSignedOut() {
        guard let oldUserID = currentUserID else { return }

        let oldPath = Path.userLibrary(userID: oldUserID)
        databaseManager.removeObserver(for: oldPath)
        unsubscribeAllPublicationObservers()
        resetState()
    }

    func resetState() {
        libraryItems = []
        publications = []
        publicationByID = [:]
        audiobooks = []
        currentUserID = nil
        initialLibraryItemIDs = []
        loadedInitialPublicationIDs = []
        isWaitingForInitialPublications = false
    }

    func cleanupAllObservers() {
        if let handle = authHandle {
            Auth.auth().removeStateDidChangeListener(handle)
        }

        if let userID = currentUserID {
            let path = Path.userLibrary(userID: userID)
            databaseManager.removeObserver(for: path)
        }

        unsubscribeAllPublicationObservers()
    }
}

// MARK: - User Library Observation

private extension UserLibraryObserver {
    func subscribeToUserLibrary(userID: String) {
        prepareForNewLibraryLoad()

        let path = Path.userLibrary(userID: userID)

        databaseManager.observeDataChanges(at: path, type: UserLibraryItemModel.self) { [weak self] change in
            self?.handleLibraryChange(change)
        }

        scheduleEmptyLibraryFallback()
    }

    func prepareForNewLibraryLoad() {
        isLoading = true
        hasLoadedInitialData = false
        initialLibraryItemIDs = []
        loadedInitialPublicationIDs = []
        isWaitingForInitialPublications = false
    }

    func handleLibraryChange(_ change: DatabaseChange<UserLibraryItemModel>) {
        switch change.type {
        case .added:
            handleItemAdded(change.item)
        case .modified:
            handleItemModified(change.item)
        case .removed:
            handleItemRemoved(change.item)
        }

        trackInitialLoad(itemID: change.item.id)
        ensurePublicationSubscriptions()
        updateAudiobooks()
    }

    func trackInitialLoad(itemID: String) {
        if !hasLoadedInitialData {
            hasLoadedInitialData = true
            initialLibraryItemIDs.insert(itemID)
            startWaitingForPublicationsIfNeeded()
        } else if isWaitingForInitialPublications {
            initialLibraryItemIDs.insert(itemID)
        }
    }

    func startWaitingForPublicationsIfNeeded() {
        guard !isWaitingForInitialPublications else { return }

        isWaitingForInitialPublications = true

        DispatchQueue.main.asyncAfter(deadline: .now() + Timing.batchingDelay) { [weak self] in
            self?.checkInitialPublicationsLoaded()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + Timing.publicationTimeout) { [weak self] in
            self?.finishLoading()
        }
    }

    func scheduleEmptyLibraryFallback() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Timing.emptyLibraryTimeout) { [weak self] in
            guard let self, !hasLoadedInitialData else { return }
            hasLoadedInitialData = true
            finishLoading()
        }
    }
}

// MARK: - Library Item Handlers

private extension UserLibraryObserver {
    func handleItemAdded(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            guard !self.libraryItems.contains(where: { $0.id == item.id }) else { return }
            self.libraryItems.append(item)
            self.subscribeToPublication(id: item.id)
        }
    }

    func handleItemModified(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            guard let index = self.libraryItems.firstIndex(where: { $0.id == item.id }) else { return }
            self.libraryItems[index] = item
            self.subscribeToPublication(id: item.id)
        }
    }

    func handleItemRemoved(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: Timing.removeAnimationDuration)) {
                self.libraryItems.removeAll { $0.id == item.id }
            }
            self.unsubscribeFromPublication(id: item.id)
            self.publicationByID.removeValue(forKey: item.id)
            self.publications.removeAll { $0.id == item.id }
            self.updateAudiobooks()
        }
    }
}

// MARK: - Publication Observation

private extension UserLibraryObserver {
    func subscribeToPublication(id: String) {
        guard publicationHandles[id] == nil else { return }

        let path = Path.catalogue + id
        let ref = databaseManager.databaseRef.child(path)
        ref.keepSynced(true)

        let handle = ref.observe(.value) { [weak self] snapshot in
            self?.handlePublicationSnapshot(snapshot, id: id)
        }

        publicationHandles[id] = handle
    }

    func handlePublicationSnapshot(_ snapshot: DataSnapshot, id: String) {
        guard snapshot.exists() else {
            removePublication(id: id)
            return
        }

        guard let value = snapshot.value as? [String: Any] else { return }

        do {
            let publication = try decodePublication(from: value, id: id)
            applyPublication(publication, id: id)
        } catch {
            print("UserLibraryObserver: Failed to decode publication \(id): \(error)")
        }
    }

    func decodePublication(from value: [String: Any], id: String) throws -> PublicationModel {
        var dict = value
        if dict["sku"] == nil { dict["sku"] = id }
        let data = try JSONSerialization.data(withJSONObject: dict)
        return try JSONDecoder().decode(PublicationModel.self, from: data)
    }

    func applyPublication(_ publication: PublicationModel, id: String) {
        DispatchQueue.main.async {
            self.publicationByID[id] = publication
            self.refreshPublications()
            self.updateAudiobooks()
            self.trackPublicationLoaded(id: id)
            NotificationCenter.default.post(name: .graphProgressDidUpdate, object: publication)
        }
    }

    func removePublication(id: String) {
        DispatchQueue.main.async {
            self.publicationByID.removeValue(forKey: id)
            self.publications.removeAll { $0.id == id }
            self.updateAudiobooks()
        }
    }

    func trackPublicationLoaded(id: String) {
        guard isWaitingForInitialPublications else { return }
        loadedInitialPublicationIDs.insert(id)
        checkInitialPublicationsLoaded()
    }

    func unsubscribeFromPublication(id: String) {
        guard let handle = publicationHandles[id] else { return }
        let path = Path.catalogue + id
        databaseManager.databaseRef.child(path).removeObserver(withHandle: handle)
        publicationHandles.removeValue(forKey: id)
    }

    func unsubscribeAllPublicationObservers() {
        for (id, handle) in publicationHandles {
            let path = Path.catalogue + id
            databaseManager.databaseRef.child(path).removeObserver(withHandle: handle)
        }
        publicationHandles.removeAll()
    }

    func ensurePublicationSubscriptions() {
        for item in libraryItems {
            subscribeToPublication(id: item.id)
        }

        let currentIDs = Set(libraryItems.map { $0.id })
        let staleIDs = publicationHandles.keys.filter { !currentIDs.contains($0) }

        for id in staleIDs {
            unsubscribeFromPublication(id: id)
            publicationByID.removeValue(forKey: id)
        }
    }
}

// MARK: - Data Refresh

private extension UserLibraryObserver {
    func refreshPublications() {
        publications = libraryItems.compactMap { publicationByID[$0.id] }
    }

    func updateAudiobooks() {
        refreshPublications()
        audiobooks = AudiobookModel.composeAudiobooks(from: publications, and: libraryItems)
    }
}

// MARK: - Loading State

private extension UserLibraryObserver {
    func checkInitialPublicationsLoaded() {
        guard initialLibraryItemIDs.isSubset(of: loadedInitialPublicationIDs) else { return }
        finishLoading()
    }

    func finishLoading() {
        guard isLoading else { return }
        isWaitingForInitialPublications = false
        withAnimation(.easeInOut(duration: Timing.loadingAnimationDuration)) {
            self.isLoading = false
        }
    }
}
