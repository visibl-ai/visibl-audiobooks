//
//  MyLibraryLayoutOption.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum MyLibraryLayoutOption: String, Identifiable, CaseIterable {
    case grid
    case list
    
    var id: Self { self }
    
    var title: String {
        switch self {
        case .grid: return "my_books_layout_grid".localized
        case .list: return "my_books_layout_list".localized
        }
    }
}
