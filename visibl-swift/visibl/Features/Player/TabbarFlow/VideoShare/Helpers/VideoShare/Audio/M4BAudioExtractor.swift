//
//  M4BAudioExtractor.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class M4BAudioExtractor {
    /// Extracts a chapter segment from M4B file using backend service
    /// Returns tuple: (localURL, gcsPath)
    static func extractChapter(
        from m4bUrl: String,
        startTime: TimeInterval,
        endTime: TimeInterval
    ) async throws -> (URL, String) {
        print("Extracting M4B segment from \(startTime) to \(endTime)")

        guard let bookId = extractBookId(from: m4bUrl) else {
            throw VideoError.exportFailed
        }

        print("Requesting backend audio extraction...")
        let (audioUrl, gcsPath) = try await extractAudioFromBackend(
            bookId: bookId,
            startTime: startTime,
            endTime: endTime
        )

        print("Backend extraction succeeded!")
        return (audioUrl, gcsPath)
    }

    /// Extracts book ID from M4B URL
    /// Example: "https://firebase.../Catalogue%2FRaw%2FVISIBL_000017.m4b" -> "VISIBL_000017"
    private static func extractBookId(from urlString: String) -> String? {
        guard let url = URL(string: urlString) else { return nil }

        let fileName = url.lastPathComponent.replacingOccurrences(of: ".m4b", with: "")
        let components = fileName.components(separatedBy: "/")
        let bookId = components.last ?? fileName

        guard !bookId.isEmpty, !bookId.contains("/") else { return nil }

        print("Extracted book ID: \(bookId) from URL: \(urlString)")
        return bookId
    }

    /// Calls backend to extract audio segment and downloads it
    /// Returns tuple: (localURL, gcsPath)
    private static func extractAudioFromBackend(
        bookId: String,
        startTime: Double,
        endTime: Double
    ) async throws -> (URL, String) {
        struct Response: Codable {
            let success: Bool
            let path: String
            let duration: Double
        }

        print("extractAudioFromBackend for bookId: \(bookId), startTime: \(startTime), endTime: \(endTime)")

        let response: Response = try await CloudFunctionService.shared.makeAuthenticatedCall(
            functionName: "v1catalogueCreateShareableClip",
            with: [
                "sku": bookId,
                "startTime": startTime,
                "endTime": endTime
            ]
        )

        guard response.success else {
            throw VideoError.exportFailed
        }

        print("Backend created clip at: \(response.path)")
        print("Clip duration: \(response.duration)s")

        let localUrl = try await CloudStorageManager.shared.downloadFile(from: response.path)
        return (localUrl, response.path)
    }
}
