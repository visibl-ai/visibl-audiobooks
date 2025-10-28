//
//  TranscriptionConfiguration.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct TranscriptionConfiguration {
    let chunkDuration: Double
    let overlapDuration: Double
    let maxConcurrentChunks: Int
    let enableProgressLogging: Bool
    
    static let `default` = TranscriptionConfiguration(
        chunkDuration: 45.0,
        overlapDuration: 2.0,
        maxConcurrentChunks: 3,
        enableProgressLogging: false
    )
}
