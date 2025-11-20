//
//  AudioURLManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AAXCPlayer

enum AudioURLError: LocalizedError {
    case aaxFileNotFound
    case invalidEncryptionData
    case conversionFailed(Error)
    case noValidURL

    var errorDescription: String? {
        switch self {
        case .aaxFileNotFound: return "AAX file not found"
        case .invalidEncryptionData: return "Invalid encryption data"
        case .conversionFailed(let error): return "Conversion failed: \(error.localizedDescription)"
        case .noValidURL: return "No valid audio URL available"
        }
    }
}

struct AudioURLResult {
    let primaryURL: URL
    let backupURL: URL?
}

final class AudioURLManager {

    func getURL(for audiobook: AudiobookModel) async -> Result<AudioURLResult, AudioURLError> {
        // Non-AAX audiobook - return direct URL with backup
        guard audiobook.isAAX else {
            guard let primaryURL = audiobook.userLibraryItem.content?.m4b?.url else {
                return .failure(.noValidURL)
            }
            let backupURL = audiobook.userLibraryItem.content?.m4b?.backupURL
            let result = AudioURLResult(primaryURL: primaryURL, backupURL: backupURL)
            return .success(result)
        }

        // AAX audiobook - check if already converted
        if audiobook.isAAXFileConverted {
            let result = AudioURLResult(primaryURL: audiobook.convertedAAXFileURL, backupURL: nil)
            return .success(result)
        }

        // Need to convert
        return await convertAAX(audiobook)
    }

    private func convertAAX(_ audiobook: AudiobookModel) async -> Result<AudioURLResult, AudioURLError> {
        guard audiobook.isAAXFileDownloaded else {
            return .failure(.aaxFileNotFound)
        }
        
        guard let aaxInfo = audiobook.aaxInfo,
              let keyData = aaxInfo.key.hexData(),
              let ivData = aaxInfo.iv.hexData() else {
            return .failure(.invalidEncryptionData)
        }
        
        await MainActor.run { Loadify.show() }
        defer { Task { await MainActor.run { Loadify.hide() } } }
        
        do {
            // Create output directory if needed
            try FileManager.default.createDirectory(
                at: audiobook.convertedAAXFileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: nil
            )
            
            var player: AAXCSelectivePlayer? = try AAXCSelectivePlayer(
                key: keyData,
                iv: ivData,
                inputPath: audiobook.aaxFilePath
            )
            
            defer {
                player?.close()
                player = nil
            }
            
            try player?.convertToM4A(outputPath: audiobook.convertedAAXFilePath)

            let result = AudioURLResult(primaryURL: audiobook.convertedAAXFileURL, backupURL: nil)
            return .success(result)
        } catch {
            return .failure(.conversionFailed(error))
        }
    }
}
