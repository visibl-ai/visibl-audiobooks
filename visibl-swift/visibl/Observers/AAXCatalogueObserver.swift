//
//  AAXCatalogueObserver.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase
import Observation
import FirebaseAuth
import Combine

final class AAXCatalogueObserver: ObservableObject {
    // MARK: - Properties
    
    @Published var publications: [PublicationModel] = []
    public let objectWillChange = ObservableObjectPublisher()
    
    private let databaseManager = RTDBManager.shared
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var currentUserID: String?
    
    /// Set of allowed publication IDs coming from the `importedSkus` node.
    private var allowedIDs: Set<String> = []
    
    /// A mapping of `publicationID -> DatabaseHandle` so we can remove observers later.
    private var publicationObservers: [String: DatabaseHandle] = [:]
    
    /// DatabaseHandle for the continuous observer on the `importedSkus` node.
    private var importedSKUsHandle: DatabaseHandle?
    
    // MARK: - Init / Deinit
    
    init() {
        subscribeForAuthStatus()
    }
    
    deinit {
        if let authHandle = authHandle {
            Auth.auth().removeStateDidChangeListener(authHandle)
        }
        unsubscribeImportedSKUs()
        unsubscribeAllPublications()
    }
    
    // MARK: - Auth and Imported SKUs Subscription
    
    private func subscribeForAuthStatus() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] auth, user in
            guard let self = self else { return }
            
            // If the user changes or signs out, remove all existing subscriptions.
            if let oldUserID = self.currentUserID,
               oldUserID != user?.uid {
                self.cleanupForSignOut()
            }
            
            if let user = user {
                // New user signed in or changed
                self.currentUserID = user.uid
                self.subscribeForImportedSKUs(userID: user.uid)
            } else {
                // Signed out
                self.cleanupForSignOut()
            }
        }
    }
    
    /// Cleans up state/subscriptions when user signs out or changes
    private func cleanupForSignOut() {
        unsubscribeImportedSKUs()
        unsubscribeAllPublications()
        allowedIDs = []
        publications = []
        currentUserID = nil
    }
    
    /// Continuously monitors the `users/<userID>/importedSkus` path.
    /// If it doesn't exist or is empty, we treat that as zero SKUs and remove our subscriptions.
    /// If it exists, we update `allowedIDs` and manage subscriptions accordingly.
    private func subscribeForImportedSKUs(userID: String) {
        let path = "users/\(userID)/importedSkus"
        let ref = Database.database().reference().child(path)
        
        // print("AAXCatalogueObserver: Subscribing for imported SKUs at \(path)")
        
        importedSKUsHandle = ref.observe(.value, with: { [weak self] snapshot in
            guard let self = self else { return }
            
            // If the node doesn't exist or is empty, snapshot.exists() == false.
            if !snapshot.exists() {
                // print("AAXCatalogueObserver: `importedSkus` is missing or empty.")
                self.allowedIDs = []
                self.unsubscribeAllPublications()
                return
            }
            
            // If the node exists, parse it into [String].
            if let skus = snapshot.value as? [String] {
                // print("AAXCatalogueObserver: `importedSkus` updated: \(skus)")
                
                let newAllowedIDs = Set(skus)
                
                // Determine which IDs were removed
                let removedIDs = self.allowedIDs.subtracting(newAllowedIDs)
                for id in removedIDs {
                    self.unsubscribePublication(id: id)
                }
                
                // Determine which IDs were just added
                let addedIDs = newAllowedIDs.subtracting(self.allowedIDs)
                for id in addedIDs {
                    self.subscribeForPublication(id: id)
                }
                
                // Update the allowedIDs reference
                self.allowedIDs = newAllowedIDs
                
            } else {
                // The node exists but it's not the expected [String]
                // print("AAXCatalogueObserver: Unexpected format for `importedSkus`.")
                self.allowedIDs = []
                self.unsubscribeAllPublications()
            }
        })
    }
    
    /// Remove the observer from the `importedSkus` path if we have one.
    private func unsubscribeImportedSKUs() {
        guard let userID = currentUserID else { return }
        let path = "users/\(userID)/importedSkus"
        let ref = Database.database().reference().child(path)
        if let handle = importedSKUsHandle {
            ref.removeObserver(withHandle: handle)
            importedSKUsHandle = nil
            // print("AAXCatalogueObserver: Unsubscribed from imported SKUs.")
        }
    }
    
    // MARK: - Publication Observation
    
    /// Subscribes to a given publication ID, storing the handle.
    private func subscribeForPublication(id: String) {
        let path = "\(ObservationDataPath.catalogue.path)/\(id)"
        let ref = Database.database().reference().child(path)
        ref.keepSynced(true)
        
        // print("AAXCatalogueObserver: Subscribing for publication \(id) at \(path)")
        
        let handle = ref.observe(.value) { [weak self] snapshot in
            guard let self = self else { return }
            
            if !snapshot.exists() {
                // print("AAXCatalogueObserver: Publication \(id) was removed.")
                DispatchQueue.main.async {
                    self.publications.removeAll { $0.id == id }
                    self.objectWillChange.send()
                }
                return
            }
            
            guard let value = snapshot.value as? [String: Any] else {
                // print("AAXCatalogueObserver: Invalid data format for publication \(id)")
                return
            }
            
            do {
                let data = try JSONSerialization.data(withJSONObject: value)
                let publication = try JSONDecoder().decode(PublicationModel.self, from: data)
                //print("AAXCatalogueObserver: Publication updated \(id) with graph progress: \(String(describing: publication.graphProgress?.progress))")
                
                DispatchQueue.main.async {
                    if let index = self.publications.firstIndex(where: { $0.id == id }) {
                        self.publications[index] = publication
                    } else {
                        self.publications.append(publication)
                    }
                    // Force UI refresh
                    self.objectWillChange.send()

                    // Notify about graph progress update
                    NotificationCenter.default.post(name: .graphProgressDidUpdate, object: publication)
                    
                    // Log to verify update is happening
//                    if let progress = publication.graphProgress?.progress {
//                        print("🔄 Graph Progress updated to: \(progress)% for publication \(id)")
//                    }
                }
            } catch {
                print("AAXCatalogueObserver: Error parsing publication \(id): \(error)")
            }
        }
        
        publicationObservers[id] = handle
    }
    
    /// Unsubscribes from a particular publication ID.
    private func unsubscribePublication(id: String) {
        let path = "\(ObservationDataPath.catalogue.path)/\(id)"
        let ref = Database.database().reference().child(path)
        if let handle = publicationObservers[id] {
            ref.removeObserver(withHandle: handle)
            publicationObservers.removeValue(forKey: id)
            DispatchQueue.main.async {
                self.publications.removeAll { $0.id == id }
            }
            // print("AAXCatalogueObserver: Unsubscribed from publication \(id).")
        }
    }
    
    /// Unsubscribes from all currently subscribed publications.
    private func unsubscribeAllPublications() {
        // print("AAXCatalogueObserver: Removing subscriptions for all publications...")
        for (id, handle) in publicationObservers {
            let path = "\(ObservationDataPath.catalogue.path)/\(id)"
            Database.database().reference().child(path).removeObserver(withHandle: handle)
        }
        publicationObservers.removeAll()
        
        DispatchQueue.main.async {
            self.publications.removeAll()
        }
        // print("AAXCatalogueObserver: All publication subscriptions removed.")
    }
}
