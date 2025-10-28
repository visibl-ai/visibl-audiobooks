//
//  AudioDownloader.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation

struct AudioDownloader {
    static func downloadAudio(from urlString: String, fileName: String) async throws -> URL {
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }

        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationUrl = documentsPath.appendingPathComponent("\(fileName).m4a")

        if FileManager.default.fileExists(atPath: destinationUrl.path) {
            try FileManager.default.removeItem(at: destinationUrl)
        }

        let (tempLocalUrl, _) = try await URLSession.shared.download(from: url)
        try FileManager.default.moveItem(at: tempLocalUrl, to: destinationUrl)

        return destinationUrl
    }

    /// Downloads partial audio file using HTTP Range requests
    /// This attempts to download only a portion of the file that likely contains the requested time range
    static func downloadPartialAudio(
        from urlString: String,
        fileName: String,
        startTime: TimeInterval,
        endTime: TimeInterval,
        estimatedDuration: TimeInterval? = nil
    ) async throws -> URL {
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }

        print("Attempting partial download using HTTP Range requests...")

        // First, get the total file size
        var headRequest = URLRequest(url: url)
        headRequest.httpMethod = "HEAD"

        let (_, headResponse) = try await URLSession.shared.data(for: headRequest)

        guard let httpResponse = headResponse as? HTTPURLResponse,
              let contentLengthString = httpResponse.value(forHTTPHeaderField: "Content-Length"),
              let totalSize = Int64(contentLengthString) else {
            print("Could not determine file size, falling back to full download")
            throw URLError(.cannotParseResponse)
        }

        // Check if server supports range requests
        let acceptRanges = httpResponse.value(forHTTPHeaderField: "Accept-Ranges")
        guard acceptRanges == "bytes" else {
            print("Server does not support range requests, falling back to full download")
            throw URLError(.unsupportedURL)
        }

        print("File size: \(totalSize) bytes, Server supports range requests")

        // Strategy: Download a contiguous range that's likely to contain the segment
        // This is safer than trying to reconstruct MP4 from chunks

        // Calculate which portion of the file likely contains our segment
        _ = endTime - startTime
        let estimatedTotalDuration = estimatedDuration ?? (endTime * 2) // rough estimate

        // Calculate percentage through the file
        let segmentMidpoint = (startTime + endTime) / 2
        let filePositionRatio = segmentMidpoint / estimatedTotalDuration

        // Adaptive download size based on file size and segment position
        // For early segments: download less (segment is near beginning)
        // For later segments: download more (need to ensure we have the data)
        let baseDownloadRatio: Double = 0.30

        // If segment is in first 10% of file, download first 20%
        // If segment is in middle, download 30% centered around it
        // If segment is later, download more
        let adjustedDownloadRatio: Double
        if filePositionRatio < 0.1 {
            // Segment is very early, download first 20%
            adjustedDownloadRatio = 0.20
        } else if filePositionRatio < 0.3 {
            // Segment is early, download first 25%
            adjustedDownloadRatio = 0.25
        } else {
            // Segment is later, download 30%
            adjustedDownloadRatio = baseDownloadRatio
        }

        // Calculate download range
        let startByte: Int64 = 0 // Always include beginning for metadata
        let downloadSize = Int64(Double(totalSize) * adjustedDownloadRatio)

        // For early segments, just download from start
        // For later segments, try to center the window
        let endByte: Int64
        if filePositionRatio < 0.2 {
            // Early segment: download from start
            endByte = min(totalSize - 1, downloadSize)
        } else {
            // Later segment: center window around estimated position
            let centerByte = Int64(Double(totalSize) * filePositionRatio)
            endByte = min(totalSize - 1, max(centerByte + downloadSize / 2, downloadSize))
        }

        let downloadMB = (endByte - startByte) / 1024 / 1024
        let totalMB = totalSize / 1024 / 1024

        print("Downloading bytes \(startByte)-\(endByte) (contiguous range)")
        print("Total download: ~\(downloadMB)MB instead of ~\(totalMB)MB (~\(Int((Double(downloadMB) / Double(totalMB)) * 100))% of file)")

        // Download the contiguous range
        var rangeRequest = URLRequest(url: url)
        rangeRequest.setValue("bytes=\(startByte)-\(endByte)", forHTTPHeaderField: "Range")

        let (rangeData, _) = try await URLSession.shared.data(for: rangeRequest)

        print("Downloaded \(rangeData.count) bytes")

        // Save to file
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationUrl = documentsPath.appendingPathComponent("\(fileName).m4b")

        try? FileManager.default.removeItem(at: destinationUrl)
        try rangeData.write(to: destinationUrl)

        print("Partial file saved to: \(destinationUrl.path)")

        return destinationUrl
    }
    
    static func trimAudio(url: URL, startTime: Double, endTime: Double) async throws -> URL {
        let asset = AVURLAsset(url: url)
        let composition = AVMutableComposition()
        
        guard let audioTrack = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw URLError(.badURL)
        }
        
        guard let sourceTrack = try await asset.loadTracks(withMediaType: .audio).first else {
            throw URLError(.badURL)
        }
        
        let timeRange = CMTimeRange(
            start: CMTime(seconds: startTime, preferredTimescale: 1000),
            end: CMTime(seconds: endTime, preferredTimescale: 1000)
        )
        
        try audioTrack.insertTimeRange(
            timeRange,
            of: sourceTrack,
            at: .zero
        )
        
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let outputURL = documentsPath.appendingPathComponent("trimmed_\(UUID().uuidString).m4a")
        
        guard let export = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPresetAppleM4A
        ) else {
            throw URLError(.badURL)
        }
        
        try await export.export(to: outputURL, as: .m4a)
        
        return outputURL
    }
}
