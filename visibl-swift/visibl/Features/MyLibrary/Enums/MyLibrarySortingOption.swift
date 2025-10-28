//
//  MyLibrarySortingOption.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum MyLibrarySortingOption: String, Identifiable, CaseIterable {
    case creationDate
    case title
    case author
    
    var id: Self { self }
    
    var title: String {
        switch self {
        case .creationDate: return "my_books_sorting_date".localized
        case .title: return "my_books_sorting_title".localized
        case .author: return "my_books_sorting_author".localized
        }
    }
}
