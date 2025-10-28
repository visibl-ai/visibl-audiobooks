//
//  MyLibraryPlaceholderType.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum MyLibraryPlaceholderType: String, Identifiable, CaseIterable {
    case signedOut
    case emptyLibrary
    case emptyCollection
    
    var id: Self { self }
    
    var icon: String {
        switch self {
        case .signedOut: return "person.circle.fill"
        case .emptyLibrary: return "safari.fill"
        case .emptyCollection: return "books.vertical.circle.fill"
        }
    }
    
    var title: String {
        switch self {
        case .signedOut: return "sign_in_call_to_action".localized
        case .emptyLibrary: return "empty_library_placeholder_title".localized
        case .emptyCollection: return "empty_collection_placeholder_title".localized
        }
    }

    var subtitle: String {
        switch self {
        case .signedOut: return "Please sign in or create account to start\nadding books to your library"
        case .emptyLibrary: return "empty_library_placeholder_subtitle".localized
        case .emptyCollection: return "empty_collection_placeholder_subtitle".localized
        }
    }

    var callToActionButtonTitle: String {
        switch self {
        case .signedOut: return "Start now"
        case .emptyLibrary: return "empty_library_placeholder_btn".localized
        case .emptyCollection: return "empty_collection_placeholder_btn".localized
        }
    }
}
