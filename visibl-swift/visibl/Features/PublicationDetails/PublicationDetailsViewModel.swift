//
//  PublicationDetailsViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth
import Combine
import SwiftUI

final class PublicationDetailsViewModel: ObservableObject {
    private let publication: PublicationModel
    
    var subscribedPublication: PublicationModel {
        if isAAXPublication {
            return privateCatalogueObserver.publications.first(where: { $0.id == publication.id }) ?? publication
        } else {
            return publicCatalogueObserver.publications.first(where: { $0.id == publication.id }) ?? publication
        }
    }
    
    private let diContainer: DIContainer
    private var userLibraryObserver: UserLibraryObserver { diContainer.userLibraryObserver }
    private var publicCatalogueObserver: CatalogueObserver { diContainer.catalogueObserver }
    private var privateCatalogueObserver: AAXCatalogueObserver { diContainer.aaxCatalogueObserver }
    
    @Published var sheetHeight: CGFloat = .zero
    @Published var presentActionSheet: Bool = false
    @Published var isLoading: Bool = false
    
    var isAdded: Bool { userLibraryObserver.libraryItems.contains(where: { $0.id == publication.id }) }
    var isAAXPublication: Bool { publication.visibility != .public }
    
    init(
        publication: PublicationModel,
        diContainer: DIContainer
    ) {
        self.publication = publication
        self.diContainer = diContainer
    }
    
    @MainActor
    func addItemToUserLibrary() async {
        isLoading = true
        
        do {
            try await UserLibraryService.addAudiobookToUserLibrary(sku: publication.id)
            try await Task.sleep(for: .seconds(1))
            isLoading = false
        } catch {
            isLoading = false
            print(error.localizedDescription)
        }
    }
}
