//
//  ImportOption.swift
//

import SwiftUI

enum ImportOption: String, Identifiable, CaseIterable {
    case aax, fromFile, fromLink
    
    var id: String { self.rawValue }
    
    var title: String {
        switch self {
        case .aax: return "import_option_aax_title".localized
        case .fromFile: return "import_option_file_title".localized
        case .fromLink: return "import_option_link_title".localized
        }
    }

    var subtitle: String {
        switch self {
        case .aax: return "import_option_aax_subtitle".localized
        case .fromFile: return "import_option_file_subtitle".localized
        case .fromLink: return "import_option_link_subtitle".localized
        }
    }
    
    var icon: String {
        switch self {
        case .aax: return "waveform"
        case .fromFile: return "document.fill"
        case .fromLink: return "link"
        }
    }
}
