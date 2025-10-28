//
//  StyleModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class StyleModel: Codable, Equatable, Hashable {
    var id: String?
    var title: String
    // var createdAt: Date?
    var userPrompt: String
    var prompt: String
    var uid: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case title
        // case createdAt
        case userPrompt
        case prompt
        case uid
    }
    
    init(
        id: String?,
        title: String,
        // createdAt: Date?,
        userPrompt: String,
        prompt: String,
        uid: String
    ) {
        self.id = id
        self.title = title
        // self.createdAt = createdAt
        self.userPrompt = userPrompt
        self.prompt = prompt
        self.uid = uid
    }
    
    // MARK: - Equatable
    static func == (lhs: StyleModel, rhs: StyleModel) -> Bool {
        return lhs.title == rhs.title
    }
    
    // MARK: - Hashable
    func hash(into hasher: inout Hasher) {
        hasher.combine(title)
    }
}
