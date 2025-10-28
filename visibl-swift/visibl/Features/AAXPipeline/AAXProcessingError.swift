//
//  AAXProcessingError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum AAXProcessingError: LocalizedError {
    case aaxClientNotConfigured
    case invalidAAXInfo
    case transcriptionIncomplete
    case downloadFailed(String)
    case conversionFailed(String)
    case transcriptionFailed(String)
    case noUserSignedIn
    case uploadFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .aaxClientNotConfigured:
            return "AAX client not configured"
        case .invalidAAXInfo:
            return "Invalid AAX decryption information"
        case .transcriptionIncomplete:
            return "Transcription did not complete successfully"
        case .downloadFailed(let message):
            return "Download failed: \(message)"
        case .conversionFailed(let message):
            return "Conversion failed: \(message)"
        case .transcriptionFailed(let message):
            return "Transcription failed: \(message)"
        case .noUserSignedIn:
            return "No user signed in"
        case .uploadFailed(let message):
            return "AAX processing failed: \(message)"
        }
    }
}
