//
//  VideoExporter.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation

final class VideoExporter {
    /// Exports the composed video to a file
    static func export(
        composition: AVComposition,
        videoComposition: AVMutableVideoComposition
    ) async throws -> URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let outputURL = documentsPath.appendingPathComponent("Video to Share.mp4")

        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        guard let export = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPresetHighestQuality
        ) else {
            throw VideoError.failedToCreateExportSession
        }

        export.videoComposition = videoComposition
        try await export.export(to: outputURL, as: .mp4)

        return outputURL
    }
}
