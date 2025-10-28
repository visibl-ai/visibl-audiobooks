//
//  SceneListState.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum SceneListState: String {
    case promptDetails
    case locationDetails
    case characterDetails
    
    var titleList: String {
        switch self {
        case .promptDetails:
            return "scene_list_prompt_details_title".localized
        case .locationDetails:
            return "scene_list_location_details_title".localized
        case .characterDetails:
            return "scene_list_character_details_title".localized
        }
    }
    
    var iconList: String {
        switch self {
        case .promptDetails:
            return "movieclapper.fill"
        case .locationDetails:
            return "mappin.and.ellipse"
        case .characterDetails:
            return "person.2.fill"
        }
    }
    
    var iconDetails: String {
        switch self {
        case .promptDetails:
            return "movieclapper"
        case .locationDetails:
            return "mappin.and.ellipse"
        case .characterDetails:
            return "person"
        }
    }
}
