//
//  TranscriptionResultSpeech.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct TranscriptionResultSpeech {
    let fullTranscript: String
    let byWordsTranscript: [String]
    let totalTranscriptionTime: Double
    let totalProcessingTime: Double
    let chunksProcessed: Int
} 
