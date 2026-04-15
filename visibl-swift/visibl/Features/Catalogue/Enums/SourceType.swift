//
//  SourceType.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum SourceType: String, Identifiable, CaseIterable, CustomStringConvertible {
    case visibl, aax, uploaded

    var id: Self { self }

    var description: String {
        switch self {
        case .visibl: return "catalogue_source_type_visibl".localized
        case .aax: return "catalogue_source_type_aax".localized
        case .uploaded: return "catalogue_source_type_uploaded".localized
        }
    }
}
