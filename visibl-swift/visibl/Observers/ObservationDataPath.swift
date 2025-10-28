//
//  ObservationDataPath.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum ObservationDataPath {
    case catalogue
    case userLibrary(userID: String)
    case importedSKUs(userID: String)
    
    var path: String {
        switch self {
        case .catalogue:
            return "catalogue/"
        case .userLibrary(let userID):
            return "users/\(userID)/library"
        case .importedSKUs(let userID):
            return "users/\(userID)/importedSKUs"
        }
    }
}
