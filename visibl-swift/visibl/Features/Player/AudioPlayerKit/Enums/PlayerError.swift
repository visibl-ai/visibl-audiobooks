//
//  PlayerError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

public enum PlayerError: Error, LocalizedError {
    case audioSessionFailed(Error)
    case invalidURL
    case loadingFailed(Error)
    case playbackFailed(Error)
    
    public var errorDescription: String? {
        switch self {
        case .audioSessionFailed(let error):
            return "Audio session error: \(error.localizedDescription)"
        case .invalidURL:
            return "Invalid audio URL"
        case .loadingFailed(let error):
            return "Failed to load audio: \(error.localizedDescription)"
        case .playbackFailed(let error):
            return "Playback failed: \(error.localizedDescription)"
        }
    }
} 
