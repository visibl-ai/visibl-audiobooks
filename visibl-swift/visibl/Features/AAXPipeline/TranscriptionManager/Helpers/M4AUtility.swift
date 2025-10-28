//
//  M4AUtility.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import AVFoundation
import Foundation

struct M4AUtility {
    static func getChapterInfo(for fileURL: URL) async throws -> [AVTimedMetadataGroup] {
        print("\n=== M4B CHAPTER INFO ===")
        print("File: \(fileURL.lastPathComponent)")
        
        let asset = AVURLAsset(url: fileURL)
        
        let availableLocales = try await asset.load(.availableChapterLocales)
        let languageCodes = availableLocales.map(\.identifier)

        print("Available locales: \(languageCodes.joined(separator: ", "))")
        
        let chapters: [AVTimedMetadataGroup]
        
        if languageCodes.isEmpty {
            chapters = try await asset.loadChapterMetadataGroups(bestMatchingPreferredLanguages: ["en", "en-US"])
        } else {
            chapters = try await asset.loadChapterMetadataGroups(bestMatchingPreferredLanguages: [languageCodes.first!])
        }
        
        print("Number of chapters: \(chapters.count)")
                
        for (index, chapter) in chapters.enumerated() {
            print("\nChapter \(index):")
            print("  Start time: \(formatDuration(chapter.timeRange.start))")
            print("  End time: \(formatDuration(CMTimeRangeGetEnd(chapter.timeRange)))")
            print("  Duration: \(formatDuration(chapter.timeRange.duration))")
            print("  Start seconds: \(CMTimeGetSeconds(chapter.timeRange.start))")
            print("  End seconds: \(CMTimeGetSeconds(CMTimeRangeGetEnd(chapter.timeRange)))")
        }
        
        print("=== END CHAPTER INFO ===\n")
        
        return chapters
    }
    
    private static func formatDuration(_ time: CMTime) -> String {
        let seconds = CMTimeGetSeconds(time)
        if seconds.isNaN || seconds.isInfinite {
            return "Invalid"
        }
        
        let hours = Int(seconds) / 3600
        let minutes = Int(seconds) % 3600 / 60
        let secs = Int(seconds) % 60
        
        if hours > 0 {
            return String(format: "%02d:%02d:%02d", hours, minutes, secs)
        } else {
            return String(format: "%02d:%02d", minutes, secs)
        }
    }
}
