//
//  SceneDataMatcher.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

protocol SceneDataMatcherProtocol {
    func matchCharacters(_ names: [String], with availableCharacters: [CharacterModel]) -> [CharacterModel]
    func matchLocation(_ name: String, with availableLocations: [LocationModel]) -> LocationModel?
}

final class SceneDataMatcher: SceneDataMatcherProtocol {
    
    // Simple normalization - just enough to handle the mismatches
    private func normalize(_ name: String) -> String {
        return name
            .lowercased()
            .replacingOccurrences(of: "'", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
    
    func matchCharacters(_ names: [String], with availableCharacters: [CharacterModel]) -> [CharacterModel] {
        names.compactMap { name in
            availableCharacters.first { character in
                normalize(character.name) == normalize(name)
            }
        }
    }
    
    func matchLocation(_ name: String, with availableLocations: [LocationModel]) -> LocationModel? {
        availableLocations.first { location in
            normalize(location.name) == normalize(name)
        }
    }
}
