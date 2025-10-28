//
//  ChapterTrimmer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import AVFoundation
import Foundation

enum ChapterTrimmerError: Error {
    case exportSessionCreationFailed
}

class ChapterTrimmer {
    static let shared = ChapterTrimmer()
    
    func extractChapterAudio(
        from sourceURL: URL,
        audiobookID: String,
        chapter: AVTimedMetadataGroup,
        chapterIndex: Int
    ) async throws -> URL {
        let tempDirectoryURL = FileManager.default.temporaryDirectory
        let audiobookDirectoryURL = tempDirectoryURL.appendingPathComponent(audiobookID)
        
        // Create the audiobook directory if it doesn't exist
        try FileManager.default.createDirectory(
            at: audiobookDirectoryURL,
            withIntermediateDirectories: true,
            attributes: nil
        )
        
        // Create unique filename for this chapter
        let chapterFileName = "\(chapterIndex).m4a"
        let chapterFileURL = audiobookDirectoryURL.appendingPathComponent(chapterFileName)
        
        // Skip if file already exists
        if FileManager.default.fileExists(atPath: chapterFileURL.path) {
            print("✅ Chapter \(chapterIndex) already exists, skipping extraction")
            return chapterFileURL
        }
        
        print("🎵 Extracting chapter \(chapterIndex)...")
        
        // Set up AVAsset and export session
        let asset = AVURLAsset(url: sourceURL)
        
        guard let exportSession = AVAssetExportSession(
            asset: asset,
            presetName: AVAssetExportPresetAppleM4A
        ) else {
            throw ChapterTrimmerError.exportSessionCreationFailed
        }
        
        exportSession.timeRange = chapter.timeRange
        exportSession.outputURL = chapterFileURL
        exportSession.outputFileType = .m4a
        
        try await exportSession.export(to: chapterFileURL, as: .m4a)
        print("✅ Chapter \(chapterIndex) extracted")
        return chapterFileURL
    }
}
