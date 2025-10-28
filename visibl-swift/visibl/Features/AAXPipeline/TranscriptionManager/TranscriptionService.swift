//
//  TranscriptionService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct TranscriptionService {
    static func submitTranscription(
        id: String,
        chapter: Int,
        transcription: String
    ) async throws -> DuplicateCheckResult {
        let result: DuplicateCheckResult = try await CloudFunctionService.shared.makeAuthenticatedCall(
            includeRawData: true,
            functionName: "v1submitAAXTranscription",
            with: [
                "sku": id,
                "chapter": chapter,
                "transcription": transcription
            ]
        )
        
        print("v1submitAAXTranscription result: \(result)")
        
        return result
    }
}
