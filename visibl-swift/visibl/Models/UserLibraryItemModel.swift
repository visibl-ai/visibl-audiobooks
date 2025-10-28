//
//  UserLibraryItemModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

// MARK: - User Library Item Model

final class UserLibraryItemModel: Codable, Identifiable {
    var id: String // which is sku
    var addedAt: Date
    var clientData: ClientDataModel
    var content: ContentModel?
    
    init(
        id: String,
        addedAt: Date,
        clientData: ClientDataModel,
    ) {
        self.id = id
        self.addedAt = addedAt
        self.clientData = clientData
    }
}

extension UserLibraryItemModel: Equatable {
    static func == (lhs: UserLibraryItemModel, rhs: UserLibraryItemModel) -> Bool {
        return lhs.id == rhs.id
    }
}

extension UserLibraryItemModel {
    var isInProgress: Bool {
        if clientData.playbackInfo.totalProgress > 0 && !clientData.isFinished {
            return true
        } else {
            return false
        }
    }
}

// MARK: - User Library Item Model

struct ClientDataModel: Codable, Equatable {
    var isFavourite: Bool
    var isFinished: Bool
    var isArchived: Bool
    
    var playbackInfo: PlaybackInfoModel
    var sceneInfo: StyleInfoModel?
    
    enum CodingKeys: String, CodingKey {
        case isFavourite
        case isFinished
        case isArchived
        case playbackInfo
        case sceneInfo
    }
}

// MARK: - Playback Info Model

struct PlaybackInfoModel: Codable, Equatable {
    var currentResourceIndex: Int
    var progressInCurrentResource: Double
    var totalProgress: Double
}

// MARK: - Style Info Model

struct StyleInfoModel: Codable, Equatable {
    var currentSceneStyle: String?
    var defaultSceneStyle: String?
    var carouselList: String?
}

// MARK: - Content Model
struct ContentModel: Codable, Equatable {
    var aax: AAXInfoModel?
    var m4b: M4BInfoModel?
    let chapters: [TranscriptionChapter?]?
}

// MARK: - Transcription Chapter Item

enum TranscriptionStatus: String, Codable, Equatable {
    case waiting = "waiting"
    case ready = "ready"
    case processing = "processing"
    case error = "error"
}

struct TranscriptionChapter: Codable, Equatable {
    let transcriptions: TranscriptionsModel
    
    struct TranscriptionsModel: Codable, Equatable {
        let status: TranscriptionStatus
    }
}

// MARK: - AAX Info Model

struct AAXInfoModel: Codable, Equatable {
    var key: String
    var iv: String
    // let url: URL
}

// MARK: - M4B Info Model

struct M4BInfoModel: Codable, Equatable {
    let url: URL
}

extension UserLibraryItemModel {
    var aaxFileURL: URL {
        FileManager.default.documentsDirectory
            .appendingPathComponent("aax_files")
            .appendingPathComponent("\(id).aax")
    }
    
    var convertedAAXFileURL: URL {
        FileManager.default.documentsDirectory
            .appendingPathComponent("converted_books")
            .appendingPathComponent("\(id).m4a")
    }
    
    var isAAXFileDownloaded: Bool {
        guard content?.aax != nil else { return false }
        return FileManager.default.fileExists(atPath: aaxFileURL.path)
    }
    
    var isAAXFileConverted: Bool {
        guard content?.aax != nil else { return false }
        return FileManager.default.fileExists(atPath: convertedAAXFileURL.path)
    }
    
    var isDownloaded: Bool { isAAXFileDownloaded || isAAXFileConverted }
}
