//
//  PublicationPreviewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PublicationPreviewModel: Identifiable, Codable {
    var id: String
    var title: String
    var cover: String?
    var authors: [String]
    var visability: Visibility

    enum Visibility: String, Codable {
        case `public`
        case `private`
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case cover = "coverArtUrl"
        case authors = "author"
        case numChapters
        case metadata
        case visability = "visibility"
    }

    private var numChapters: Int?
    private var metadata: Metadata?
    
    private struct Metadata: Codable {
        var desc: String?
        var length: Double
        var year: String?
        
        enum CodingKeys: String, CodingKey {
            case desc = "description"
            case length
            case year
        }
    }
}

// MARK: - Helpers
extension PublicationPreviewModel {
    private static let uploadedPrefix = "CSTM_"

    var sourceType: SourceType {
        if id.hasPrefix(Self.uploadedPrefix) {
            return .uploaded
        } else if visability == .public {
            return .visibl
        } else {
            return .aax
        }
    }

    var coverUrl: String? {
        guard let cover, !cover.isEmpty else { return nil }
        return cover
    }

    var description: String {
        guard let desc = metadata?.desc, !desc.isEmpty else {
            return "No description available."
        }
        return desc
    }

    var year: String? {
        guard let year = metadata?.year, !year.isEmpty else { return nil }
        return year
    }

    var duration: String? {
        guard let length = metadata?.length else { return nil }
        return length.formatTimeToHHmm()
    }

    var chaptersCount: String? {
        numChapters.map { "\($0) p" }
    }
}

extension PublicationPreviewModel: Hashable, Equatable {
    static func == (
        lhs: PublicationPreviewModel,
        rhs: PublicationPreviewModel
    ) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
