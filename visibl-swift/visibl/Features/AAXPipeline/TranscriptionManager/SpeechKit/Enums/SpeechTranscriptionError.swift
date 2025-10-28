//
//  SpeechTranscriptionError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum SpeechTranscriptionError: Error, LocalizedError {
    case recognizerNotConfigured
    case noChunksCreated
    case audioProcessingFailed(String)
    case transcriptionCancelled
    case configurationError(String)
    
    var errorDescription: String? {
        switch self {
        case .recognizerNotConfigured:
            return "Speech recognizer not configured. Please call setupSpeech() first."
        case .noChunksCreated:
            return "No audio chunks could be created from the source file."
        case .audioProcessingFailed(let message):
            return "Audio processing failed: \(message)"
        case .transcriptionCancelled:
            return "Transcription was cancelled by user."
        case .configurationError(let message):
            return "Configuration error: \(message)"
        }
    }
}
