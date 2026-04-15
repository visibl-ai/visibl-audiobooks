//
//  AAXCountry.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum AAXCountry: String, CaseIterable, Identifiable {
    case unitedKingdom, unitedStates, canada, australia, germany, france, italy, spain, brazil, india, japan

    var id: String { self.rawValue }
    
    var requestString: String {
        switch self {
        case .unitedKingdom: return "uk"
        case .unitedStates: return "us"
        case .canada: return "ca"
        case .australia: return "au"
        case .germany: return "de"
        case .france: return "fr"
        case .italy: return "it"
        case .spain: return "es"
        case .brazil: return "br"
        case .india: return "in"
        case .japan: return "jp"
        }
    }
    
    var flag: String {
        switch self {
        case .unitedKingdom: return "🇬🇧"
        case .unitedStates: return "🇺🇸"
        case .canada: return "🇨🇦"
        case .australia: return "🇦🇺"
        case .germany: return "🇩🇪"
        case .france: return "🇫🇷"
        case .italy: return "🇮🇹"
        case .spain: return "🇪🇸"
        case .brazil: return "🇧🇷"
        case .india: return "🇮🇳"
        case .japan: return "🇯🇵"
        }
    }
    
    var name: String {
        switch self {
        case .unitedKingdom: return "United Kingdom"
        case .unitedStates: return "United States"
        case .canada: return "Canada"
        case .australia: return "Australia"
        case .germany: return "Germany"
        case .france: return "France"
        case .italy: return "Italy"
        case .spain: return "Spain"
        case .brazil: return "Brazil"
        case .india: return "India"
        case .japan: return "Japan"
        }
    }
    
    var localizedName: String {
        return self.name.localized
    }

    static func flag(for countryCode: String) -> String {
        guard let country = AAXCountry.allCases.first(where: { $0.requestString == countryCode.lowercased() }) else {
            return "🏳️"
        }
        return country.flag
    }
}
