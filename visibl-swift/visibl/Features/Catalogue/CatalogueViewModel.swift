//
//  CatalogueViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import SwiftUI

final class CatalogueViewModel: ObservableObject {
    private let catalogueObserver: CatalogueObserver
    private let userLibraryObserver: UserLibraryObserver
    private let aaxCatalogueObserver: AAXCatalogueObserver
    private let aaxClient: AAXClientWrapper
    private let aaxAuthDataObserver: AAXAuthDataObserver
    
    var publicPublications: [PublicationModel] {
        catalogueObserver.publications.sorted {
            $0.title.lowercased() < $1.title.lowercased()
        }
    }
    
    var isPublicaFeedLoading: Bool = false
    
    var privatePublications: [PublicationModel] {
        aaxCatalogueObserver.publications.sorted {
            $0.title.lowercased() < $1.title.lowercased()
        }
    }
    var isPrivateFeedLoading: Bool = false
    
    @Published var isAAXConnected: Bool = false
    private let userConfig = UserConfigurations.shared
    private var cancellables = Set<AnyCancellable>()
        
    init(
        catalogueObserver: CatalogueObserver,
        userLibraryObserver: UserLibraryObserver,
        aaxCatalogueObserver: AAXCatalogueObserver,
        aaxClient: AAXClientWrapper,
        aaxAuthDataObserver: AAXAuthDataObserver
    ) {
        self.catalogueObserver = catalogueObserver
        self.userLibraryObserver = userLibraryObserver
        self.aaxCatalogueObserver = aaxCatalogueObserver
        self.aaxClient = aaxClient
        self.aaxAuthDataObserver = aaxAuthDataObserver
        bind()
    }
    
    private func bind() {
        aaxAuthDataObserver.$aaxAuthData
            .sink(receiveValue: { [weak self] aaxAuthData in
                self?.isAAXConnected = aaxAuthData != nil
            })
            .store(in: &cancellables)
    }
}
