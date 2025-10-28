//
//  DIContainer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class DIContainer {
    private(set) lazy var player: AudioPlayerManager = {
        AudioPlayerManager()
    }()
    
    private(set) lazy var catalogueObserver: CatalogueObserver = {
        CatalogueObserver()
    }()
    
    private(set) lazy var userLibraryObserver: UserLibraryObserver = {
        UserLibraryObserver()
    }()
    
    private(set) lazy var aaxCatalogueObserver: AAXCatalogueObserver = {
        AAXCatalogueObserver()
    }()
    
    private(set) lazy var aaxAuthDataObserver: AAXAuthDataObserver = {
        AAXAuthDataObserver()
    }()
    
    private(set) lazy var authService: AuthServiceProtocol = {
        AuthService()
    }()
    
    private(set) lazy var aaxClient: AAXClientWrapper = {
        AAXClientWrapper(
            aaxAuthDataObserver: aaxAuthDataObserver,
            authService: authService
        )
    }()
    
    @MainActor private(set) lazy var aaxPipeline: AAXPipeline = {
        AAXPipeline(aaxClient: aaxClient, authService: authService)
    }()
}

// MARK: - Equatable & Hashable

extension DIContainer: Equatable, Hashable {
    static func == (lhs: DIContainer, rhs: DIContainer) -> Bool {
        return lhs === rhs
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(self))
    }
}
