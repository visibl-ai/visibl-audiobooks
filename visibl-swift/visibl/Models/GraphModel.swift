//
//  GraphModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

// MARK: - Graph

struct GraphDataModel: Codable {
    let chapters: [GraphChapterModel?]

    private enum CodingKeys: String, CodingKey {
        case chapters
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Try to decode as array first
        if let chaptersArray = try? container.decode([GraphChapterModel?].self, forKey: .chapters) {
            self.chapters = chaptersArray
        }
        // If that fails, try to decode as dictionary and convert to array
        else if let chaptersDict = try? container.decode([String: GraphChapterModel?].self, forKey: .chapters) {
            // Find the maximum index to create proper array size
            let maxIndex = chaptersDict.keys.compactMap { Int($0) }.max() ?? 0

            // Create array with nil values for missing indices
            var chaptersArray: [GraphChapterModel?] = Array(repeating: nil, count: maxIndex + 1)

            // Populate array at correct indices
            for (key, value) in chaptersDict {
                if let index = Int(key) {
                    chaptersArray[index] = value
                }
            }

            self.chapters = chaptersArray
        }
        // If both fail, default to empty array
        else {
            self.chapters = []
        }
    }
}

// MARK: - Graph Chapter

struct GraphChapterModel: Codable {
    private let characters: [String: CharacterModel]?
    private let locations: [String: LocationModel]?
    
    // Computed properties that return arrays with names included
    var charactersArray: [CharacterModel] {
        guard let characters = characters else { return [] }
        return characters.map { key, value in
            var character = value
            character.name = key  // Set name from dictionary key
            return character
        }
    }
    
    var locationsArray: [LocationModel] {
        guard let locations = locations else { return [] }
        return locations.map { key, value in
            var location = value
            location.name = key  // Set name from dictionary key
            return location
        }
    }
    
    private enum CodingKeys: String, CodingKey {
        case characters, locations
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        characters = try container.decodeIfPresent([String: CharacterModel].self, forKey: .characters)
        locations = try container.decodeIfPresent([String: LocationModel].self, forKey: .locations)
    }
}

// MARK: - Character Model

struct CharacterModel: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var name: String = ""  // Add name property with default value
    let image: String?
    let profileImage: String?
    let description: String?
    private let unsummarizedDescription: String?
    
    private enum CodingKeys: String, CodingKey {
        case image, description, unsummarizedDescription, profileImage
        // Note: 'name' and 'id' are not in CodingKeys since they're not in Firebase
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = UUID().uuidString  // Generate ID since it's not in Firebase
        self.name = ""  // Will be set from dictionary key
        self.image = try container.decodeIfPresent(String.self, forKey: .image)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.unsummarizedDescription = try container.decodeIfPresent(String.self, forKey: .unsummarizedDescription)
        self.profileImage = try container.decodeIfPresent(String.self, forKey: .profileImage)
    }
}

// MARK: - Location Model

struct LocationModel: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var name: String = ""  // Add name property with default value
    let image: String?
    let description: String?
    private let unsummarizedDescription: String?
    
    private enum CodingKeys: String, CodingKey {
        case image, description, unsummarizedDescription
        // Note: 'name' and 'id' are not in CodingKeys since they're not in Firebase
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = UUID().uuidString  // Generate ID since it's not in Firebase
        self.name = ""  // Will be set from dictionary key
        self.image = try container.decodeIfPresent(String.self, forKey: .image)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.unsummarizedDescription = try container.decodeIfPresent(String.self, forKey: .unsummarizedDescription)
    }
}
