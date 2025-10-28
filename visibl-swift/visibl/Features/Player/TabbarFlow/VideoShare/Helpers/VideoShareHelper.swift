//
//  VideoShareHelper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class VideoShareHelper {
    /// Creates a video from an array of scenes and an audio URL
    static func createVideo(
        from scenes: [SceneModel],
        audioUrlString: String,
        bookId: String,
        bookTitle: String,
        authorName: String,
        styleName: String,
        isLocalFile: Bool,
        m4bUrl: String? = nil,
        chapterStartTime: TimeInterval? = nil,
        chapterEndTime: TimeInterval? = nil,
        progress: VideoShareProgress? = nil
    ) async throws -> URL {
        let config = VideoShareConfiguration(
            scenes: scenes,
            audioUrlString: audioUrlString,
            bookId: bookId,
            bookTitle: bookTitle,
            authorName: authorName,
            styleName: styleName,
            isLocalFile: isLocalFile,
            m4bUrl: m4bUrl,
            chapterStartTime: chapterStartTime,
            chapterEndTime: chapterEndTime
        )

        return try await VideoShareCoordinator.createVideo(config: config, progress: progress)
    }
}
