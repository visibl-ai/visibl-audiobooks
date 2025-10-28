//
//  SceneModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct SceneModel: Codable, Equatable, Hashable, Identifiable {
    var id: String { sceneId ?? UUID().uuidString }
    var sceneNumber: Int
    var startTime: Double
    var endTime: Double
    var image: String?
    let sceneId: String?
    let prompt: String?
    let description: String?
    let chapter: Int?
    var characterNames: [String]?  // Array of character names
    var locationName: [String]?   // Array of location names
    var characters: [CharacterModel]?
    var location: LocationModel?
    var derivedScenes: [String: DerivedSceneModel]?
    
    enum CodingKeys: String, CodingKey {
        case sceneNumber = "scene_number"
        case startTime
        case endTime
        case image
        case sceneId
        case prompt
        case description
        case chapter
        case characterNames = "characters"
        case locationName = "locations"
        case derivedScenes = "styles"
    }
}

struct DerivedSceneModel: Codable, Equatable, Hashable, Identifiable {
    var id: String
    var image: String
    var title: String
    
    enum CodingKeys: String, CodingKey {
        case id = "styleId"
        case image
        case title
    }
}
