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

final class AudioURLManager {
    
    func getURL(for audiobook: AudiobookModel) async -> Result<URL, AudioURLError> {
        // Non-AAX audiobook - return direct URL
        guard audiobook.isAAX else {
            guard let url = audiobook.userLibraryItem.content?.m4b?.url else {
                return .failure(.noValidURL)
            }
            return .success(url)
        }
        
        // AAX audiobook - check if already converted
        if audiobook.isAAXFileConverted {
            return .success(audiobook.convertedAAXFileURL)
        }
        
        // Need to convert
        return await convertAAX(audiobook)
    }
    
    private func convertAAX(_ audiobook: AudiobookModel) async -> Result<URL, AudioURLError> {
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
            
            return .success(audiobook.convertedAAXFileURL)
        } catch {
            return .failure(.conversionFailed(error))
        }
    }
}
