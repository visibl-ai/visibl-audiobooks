//
//  AudioPreparationService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class AudioPreparationService {
    /// Prepares the audio file for processing
    /// Returns tuple: (AudioFile, needsTrimming)
    static func prepareAudio(
        config: VideoShareConfiguration,
        sceneStartTime: TimeInterval,
        sceneEndTime: TimeInterval
    ) async throws -> (AudioFile, Bool) {
        if config.isLocalFile {
            return try prepareLocalAudio(
                audioUrlString: config.audioUrlString,
                bookId: config.bookId
            )
        } else {
            return try await prepareRemoteAudio(
                audioUrlString: config.audioUrlString,
                m4bUrl: config.m4bUrl,
                chapterStartTime: config.chapterStartTime,
                sceneStartTime: sceneStartTime,
                sceneEndTime: sceneEndTime
            )
        }
    }

    /// Trims the audio to match scene times
    static func trimAudio(
        file: AudioFile,
        startTime: Double,
        endTime: Double
    ) async throws -> AudioFile {
        print("Trimming audio from \(startTime) to \(endTime)")
        let trimmedAudioUrl = try await AudioDownloader.trimAudio(
            url: file.localURL,
            startTime: startTime,
            endTime: endTime
        )
        print("Trimmed audio saved at: \(trimmedAudioUrl.path)")
        // Trimmed file is local, no GCS path
        return AudioFile(localURL: trimmedAudioUrl, gcsPath: nil)
    }

    // MARK: - Private Helpers

    private static func prepareLocalAudio(
        audioUrlString: String,
        bookId: String
    ) throws -> (AudioFile, Bool) {
        let documentsUrl = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]

        let fileName = audioUrlString.hasPrefix(bookId)
            ? audioUrlString
            : "\(bookId).m4a"

        // Try Documents directory first (where converted AAX files should be)
        let documentsAudioFileUrl = documentsUrl
            .appendingPathComponent("converted_books")
            .appendingPathComponent(fileName)

        print("Looking for audio at: \(documentsAudioFileUrl.path)")

        if FileManager.default.fileExists(atPath: documentsAudioFileUrl.path) {
            print("Found audio file in Documents directory")
            let audioFile = AudioFile(localURL: documentsAudioFileUrl, gcsPath: nil)
            return (audioFile, true)
        }

        // Fallback: check Caches directory for legacy files
        let cachesAudioFileUrl = cachesUrl
            .appendingPathComponent("converted_books")
            .appendingPathComponent(fileName)

        print("Checking fallback location at: \(cachesAudioFileUrl.path)")

        guard FileManager.default.fileExists(atPath: cachesAudioFileUrl.path) else {
            print("Audio file not found in Documents or Caches directories")
            print("Expected locations:")
            print("  - Documents: \(documentsAudioFileUrl.path)")
            print("  - Caches: \(cachesAudioFileUrl.path)")
            throw VideoError.localAudioFileNotFound
        }

        print("Found audio file in Caches directory (legacy location)")
        // Local files have no GCS path
        let audioFile = AudioFile(localURL: cachesAudioFileUrl, gcsPath: nil)
        // Local AAX files need trimming
        return (audioFile, true)
    }

    private static func prepareRemoteAudio(
        audioUrlString: String,
        m4bUrl: String?,
        chapterStartTime: TimeInterval?,
        sceneStartTime: TimeInterval,
        sceneEndTime: TimeInterval
    ) async throws -> (AudioFile, Bool) {
        // For M4B books, extract precise segment
        if let m4bUrlString = m4bUrl,
           let chapterStart = chapterStartTime {
            let absoluteStartTime = sceneStartTime
            let absoluteEndTime = sceneEndTime

            print("Extracting M4B segment from \(absoluteStartTime) to \(absoluteEndTime) (scene range: \(sceneStartTime)-\(sceneEndTime) in chapter starting at \(chapterStart))")

            let (audioUrl, gcsPath) = try await M4BAudioExtractor.extractChapter(
                from: m4bUrlString,
                startTime: absoluteStartTime,
                endTime: absoluteEndTime
            )

            let audioFile = AudioFile(localURL: audioUrl, gcsPath: gcsPath)
            // Already extracted exact range, no trimming needed
            return (audioFile, false)
        } else {
            // Fallback to downloading individual chapter URL
            let audioUrl = try await AudioDownloader.downloadAudio(
                from: audioUrlString,
                fileName: "chapter_audio"
            )
            // Downloaded files have no GCS path (not temporary)
            let audioFile = AudioFile(localURL: audioUrl, gcsPath: nil)
            // Downloaded full chapter, needs trimming
            return (audioFile, true)
        }
    }
}
