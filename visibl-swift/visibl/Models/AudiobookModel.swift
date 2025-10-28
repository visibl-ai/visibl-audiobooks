//
//  AudiobookModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class AudiobookModel: Identifiable {
    var id: String
    var publication: PublicationModel
    var userLibraryItem: UserLibraryItemModel
    
    // Metadata
    var coverURL: String { publication.coverArtUrl }
    var title: String { publication.title }
    var authors: [String] { publication.availableAuthors }
    var duration: Double { publication.metadata?.duration ?? 0.0 } /// TODO: handle nil and fetch duration from file metadata
    
    var readingOrder: [ChapterModel] { publication.metadata?.chapters ?? [] }
    
    // User Editable
    var addedDate: Date { userLibraryItem.addedAt }
    var isInProgress: Bool { userLibraryItem.isInProgress }
    var isFinished: Bool { userLibraryItem.clientData.isFinished }
    var isArchived: Bool { userLibraryItem.clientData.isArchived }
    var isFavourite: Bool { userLibraryItem.clientData.isFavourite }
    
    // Playback
    var playbackInfo: PlaybackInfoModel { userLibraryItem.clientData.playbackInfo }
    
    // Style and Scenes
    var sceneStyleInfo: StyleInfoModel { userLibraryItem.clientData.sceneInfo ?? .init(currentSceneStyle: "", defaultSceneStyle: "") }
    // var sceneStyles: [StyleModel] { publication.sceneStyles ?? [] }
    var hasStyles: Bool { !(publication.styles?.isEmpty ?? true) }
    
    // AAX
    var aaxInfo: AAXInfoModel? { userLibraryItem.content?.aax }
    var isVoucherValid: Bool = true
    var hasGraph: Bool { publication.graphAvailable ?? false }
    var graphProgress: GraphStatusModel? { publication.graphProgress }
    
    // Helpers
    var currentChapterTitle: String {
        readingOrder[playbackInfo.currentResourceIndex].title ?? "Audiotrack #\(playbackInfo.currentResourceIndex + 1)"
    }
    
    init(
        id: String,
        publication: PublicationModel,
        userLibraryItem: UserLibraryItemModel
    ) {
        self.id = id
        self.publication = publication
        self.userLibraryItem = userLibraryItem
    }
}

// MARK: - Transcription Related

extension AudiobookModel {
    var isPlayable: Bool {
        if hasGraph { return true }
        if isAAX {
            let chapters = userLibraryItem.content?.chapters?.compactMap { $0 } ?? []
            let readingOrderChapters = publication.metadata?.chapters ?? []
            var totalDuration: Double = 0
            let minimumDuration: Double = 5 * 60 // 5 minutes in seconds
            
            // Check chapters sequentially until we reach 5+ minutes
            for (index, transcriptionChapter) in chapters.enumerated() {
                // Make sure we have corresponding reading order chapter for duration
                guard index < readingOrderChapters.count else { break }
                
                // Check if this chapter is ready
                guard transcriptionChapter.transcriptions.status == .ready else {
                    return false
                }
                
                // Add this chapter's duration
                totalDuration += readingOrderChapters[index].duration
                
                // If we've reached 5+ minutes, we're good
                if totalDuration >= minimumDuration {
                    return true
                }
            }
            
            // If we've checked all chapters and still under 5 minutes,
            // but all available chapters are ready, return true
            return totalDuration > 0
        } else {
            return true
        }
    }
    
    var progressString: String {
        let chapters = userLibraryItem.content?.chapters?.compactMap { $0 } ?? []
        let totalChapters = chapters.count
        
        let completedChapters = chapters.filter { chapter in
            chapter.transcriptions.status == .ready || chapter.transcriptions.status == .processing || chapter.transcriptions.status == .error
        }.count
        
        let progressString = "\(completedChapters)/\(totalChapters)"
        
        return progressString
    }
}

// MARK: - AAX

extension AudiobookModel {
    var aaxFileURL: URL {
        FileManager.default.documentsDirectory
            .appendingPathComponent("aax_files")
            .appendingPathComponent("\(id).aax")
    }
    
    var aaxFilePath: String {
        FileManager.default.documentsDirectory
            .appendingPathComponent("aax_files")
            .appendingPathComponent("\(id).aax")
            .path
    }

    var convertedAAXFileURL: URL {
        FileManager.default.documentsDirectory
            .appendingPathComponent("converted_books")
            .appendingPathComponent("\(id).m4a")
    }
    
    var convertedAAXFilePath: String {
        FileManager.default.documentsDirectory
            .appendingPathComponent("converted_books")
            .appendingPathComponent("\(id).m4a")
            .path
    }

    var isAAXFileDownloaded: Bool {
        guard aaxInfo != nil else { return false }
        return FileManager.default.fileExists(atPath: aaxFileURL.path)
    }

    var isAAXFileConverted: Bool {
        guard aaxInfo != nil else { return false }
        return FileManager.default.fileExists(atPath: convertedAAXFileURL.path)
    }

    var isDownloaded: Bool {
        isAAXFileDownloaded && isAAXFileConverted
    }
    
    var isAAX: Bool { publication.visibility == .private }
}

// MARK: - Hashable & Equatable

extension AudiobookModel: Hashable, Equatable {
    static func == (lhs: AudiobookModel, rhs: AudiobookModel) -> Bool {
        return lhs.id == rhs.id
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
