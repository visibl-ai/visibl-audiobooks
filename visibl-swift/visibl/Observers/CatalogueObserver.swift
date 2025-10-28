//
//  CatalogueObserver.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase

final class CatalogueObserver: ObservableObject {
    @Published var publications: [PublicationModel] = []
    
    private let databaseManager = RTDBManager.shared
    private var queryHandles: [DatabaseHandle] = []
    private var catalogueQuery: DatabaseQuery?
    
    init() {
        subscribe()
    }
    
    deinit {
        unsubscribe()
    }
    
    private func subscribe() {
        let dbRef = databaseManager.databaseRef.child(ObservationDataPath.catalogue.path)
        dbRef.keepSynced(true)
        let query = dbRef.queryOrdered(byChild: "visibility").queryEqual(toValue: "public")
        catalogueQuery = query
        
        queryHandles = databaseManager.observeDataChanges(at: query, type: PublicationModel.self) { [weak self] change in
            guard let self = self else { return }
            switch change.type {
            case .added:
                self.handleAdded(change.item)
            case .modified:
                self.handleModified(change.item)
            case .removed:
                self.handleRemoved(change.item)
            }
        }
    }
    
    private func handleAdded(_ item: PublicationModel) {
        DispatchQueue.main.async {
            if !self.publications.contains(where: { $0.id == item.id }) {
                self.publications.append(item)
            }
        }
    }
    
    private func handleModified(_ item: PublicationModel) {
        DispatchQueue.main.async {
            if let index = self.publications.firstIndex(where: { $0.id == item.id }) {
                self.publications[index] = item
            }
        }
    }
    
    private func handleRemoved(_ item: PublicationModel) {
        DispatchQueue.main.async {
            self.publications.removeAll { $0.id == item.id }
        }
    }
    
    private func unsubscribe() {
        guard let query = catalogueQuery else { return }
        for handle in queryHandles {
            query.removeObserver(withHandle: handle)
        }
        
        queryHandles.removeAll()
    }
}
