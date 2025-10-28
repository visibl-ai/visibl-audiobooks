//
//  PublicationModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

// MARK: - Publication Model

class PublicationModel: Codable, Identifiable, Equatable, Hashable {
    var id: String { sku }
    let sku: String
    let metadata: MetadataModel?
    let coverArtUrl: String
    // var sceneStyles: [StyleModel]?
    let visibility: Visibility

    var graphAvailable: Bool?
    var graphProgress: GraphStatusModel?
    var defaultGraphId: String?
    var defaultSceneId: String?

    var title: String
    private var authors: [String]?
    var availableAuthors: [String] { authors ?? metadata?.author ?? [] }

    var styles: [String: StyleModel]?

    enum CodingKeys: String, CodingKey {
        case sku
        case metadata
        case coverArtUrl = "coverArtUrl"
        // case sceneStyles = "scenes"
        case visibility
        case graphAvailable
        case graphProgress
        case defaultGraphId
        case title
        case authors = "author"
        case defaultSceneId
        case styles
    }

    enum Visibility: String, Codable {
        case `public`
        case `private`
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // decode (required fields)
        sku = try container.decode(String.self, forKey: .sku)
        coverArtUrl = try container.decode(String.self, forKey: .coverArtUrl)
        visibility = try container.decode(Visibility.self, forKey: .visibility)
        title = try container.decode(String.self, forKey: .title)

        // decodeIfPresent (optional fields)
        metadata = try container.decodeIfPresent(MetadataModel.self, forKey: .metadata)
        graphAvailable = try container.decodeIfPresent(Bool.self, forKey: .graphAvailable)
        graphProgress = try container.decodeIfPresent(GraphStatusModel.self, forKey: .graphProgress)
        defaultGraphId = try container.decodeIfPresent(String.self, forKey: .defaultGraphId)
        defaultSceneId = try container.decodeIfPresent(String.self, forKey: .defaultSceneId)
        authors = try container.decodeIfPresent([String].self, forKey: .authors)
        styles = try container.decodeIfPresent([String: StyleModel].self, forKey: .styles)

        // special case with try?
        // sceneStyles = try? container.decodeFlexible(StyleModel.self, forKey: .sceneStyles)
    }

    var isAAX: Bool {
        visibility == .private
    }

    static func == (lhs: PublicationModel, rhs: PublicationModel) -> Bool {
        lhs.sku == rhs.sku
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(sku)
    }
}

// MARK: - Metadata Model

class MetadataModel: Codable, Equatable, Hashable {
    let title: String
    let author: [String]
    let duration: Double
    let chapters: [ChapterModel]

    let description: String?
    let year: String?

    enum CodingKeys: String, CodingKey {
        case title
        case author
        case duration = "length"
        case chapters
        case description
        case year
    }

    static func == (lhs: MetadataModel, rhs: MetadataModel) -> Bool {
        lhs.title == rhs.title && lhs.author == rhs.author && lhs.duration == rhs.duration
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(title)
        hasher.combine(author)
        hasher.combine(duration)
    }
}

// MARK: - Chapter Model

class ChapterModel: Codable, Equatable, Hashable {
    let startTime: Double
    let endTime: Double
    var duration: Double { endTime - startTime }
    let title: String?
    let url: URL?

    static func == (lhs: ChapterModel, rhs: ChapterModel) -> Bool {
        lhs.startTime == rhs.startTime && lhs.endTime == rhs.endTime
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(startTime)
        hasher.combine(endTime)
    }
}

// MARK: - Graph Status Model

class GraphStatusModel: Codable, Equatable, Hashable {
    let progress: Int
    let description: [String: String]?
    var completedChapters: [Int]?
    var processingChapters: [Int]?

    enum CodingKeys: String, CodingKey {
        case progress = "completion"
        case description
        case completedChapters
        case processingChapters
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(progress)
    }

    static func == (lhs: GraphStatusModel, rhs: GraphStatusModel) -> Bool {
        return lhs.progress == rhs.progress
    }
}

extension Notification.Name {
    static let graphProgressDidUpdate = Notification.Name("graphProgressDidUpdate")
}
