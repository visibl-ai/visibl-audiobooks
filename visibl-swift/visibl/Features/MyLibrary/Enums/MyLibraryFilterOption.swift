//
//  MyLibraryFilterOption.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum MyLibraryFilterOption: String, Identifiable, CaseIterable {
    case all
    case isFavorite
    case listeningNow
    case finished
    case archived
    
    var id: Self { self }
    
    var title: String {
        switch self {
        case .all: return "my_books_filter_all".localized
        case .isFavorite: return "my_books_filter_favorite".localized
        case .listeningNow: return "my_books_filter_listening_now".localized
        case .finished: return "my_books_filter_finished".localized
        case .archived: return "my_books_filter_archived".localized
        }
    }
}
