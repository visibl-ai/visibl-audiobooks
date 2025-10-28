//
//  UserLibraryObserver.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase
import FirebaseAuth
import Observation
import SwiftUI

final class UserLibraryObserver: ObservableObject {
    @Published var libraryItems: [UserLibraryItemModel] = []
    @Published var isLoading: Bool = true
    
    private let databaseManager = RTDBManager.shared
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var currentUserID: String?
    private var hasLoadedInitialData = false

    init() {
        subscribeForAuthStatus()
        print("UserLibraryObserver is initialized")
    }
    
    deinit {
        if let handle = authHandle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
        
        if let userID = currentUserID {
            let path = ObservationDataPath.userLibrary(userID: userID).path
            databaseManager.removeObserver(for: path)
        }
    }
    
    private func subscribeForAuthStatus() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] auth, user in
            guard let self = self else { return }
            if let oldUserID = self.currentUserID {
                let oldPath = ObservationDataPath.userLibrary(userID: oldUserID).path
                self.databaseManager.removeObserver(for: oldPath)
                self.libraryItems = []
                self.currentUserID = nil
            }
            
            if let user = user {
                self.currentUserID = user.uid
                self.subscribeForUserLibrary(userID: user.uid)
            } else {
                self.libraryItems = []
                withAnimation(.easeInOut(duration: 0.5)) {
                    self.isLoading = false
                }
            }
        }
    }
    
    private func subscribeForUserLibrary(userID: String) {
        isLoading = true
        hasLoadedInitialData = false
        let path = ObservationDataPath.userLibrary(userID: userID).path
        
        databaseManager.observeDataChanges(at: path, type: UserLibraryItemModel.self) { [weak self] change in
            guard let self = self else { return }
            switch change.type {
            case .added:
                self.handleAdded(change.item)
            case .modified:
                self.handleModified(change.item)
            case .removed:
                self.handleRemoved(change.item)
            }
            
            // Mark the initial load as done on the first update.
            if !self.hasLoadedInitialData {
                self.hasLoadedInitialData = true
                withAnimation(.easeInOut(duration: 0.5)) {
                    self.isLoading = false
                }
            }
        }
        
        // Fallback in case no update is received (e.g. empty library)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self else { return }
            if !self.hasLoadedInitialData {
                self.hasLoadedInitialData = true
                withAnimation(.easeInOut(duration: 0.5)) {
                    self.isLoading = false
                }
            }
        }
    }
    
    private func handleAdded(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            if !self.libraryItems.contains(where: { $0.id == item.id }) {
                self.libraryItems.append(item)
            }
        }
    }
    
    private func handleModified(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            if let index = self.libraryItems.firstIndex(where: { $0.id == item.id }) {
                self.libraryItems[index] = item
            }
        }
    }
    
    private func handleRemoved(_ item: UserLibraryItemModel) {
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: 0.25)) {
                self.libraryItems.removeAll { $0.id == item.id }
            }
        }
    }
}
