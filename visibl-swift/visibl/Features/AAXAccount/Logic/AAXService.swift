//
//  AAXService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct AAXService {
    static func submitLibrary(libraryData: Any) async throws {
        try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
            functionName: "v1updateAAXCLibrary",
            with: ["aaxcLibrary": libraryData]
        )
    }
    
    static func submitMetadata(sku: String, metadata: Any) async throws {
        try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
            functionName: "v1updateAAXMetadata",
            with: [
                "sku": sku,
                "metadata": metadata
            ]
        )
    }
    
    static func connectAAX(aaxUserId: String) async throws -> DuplicateCheckResult {
        let result: DuplicateCheckResult = try await CloudFunctionService.shared.makeAuthenticatedCall(
            functionName: "v1aaxConnect",
            with: ["aaxUserId": aaxUserId]
        )
        
        print("v1aaxConnect result: \(result)")
        
        return result
    }
    
    static func disconnectAAX(userId: String) async throws {
        try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
            functionName: "v1disconnectAAX",
            with: ["uid": userId]
        )
    }
    
    static func requestDownloadedBookProcessing(sku: String) async throws {
        try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
            functionName: "v1processPrivateM4B",
            with: ["sku": sku]
        )
        print("✅ Processing private M4B for \(sku) requested")
    }
}

struct DuplicateCheckResult: Codable {
    let success: Bool
    let error: String?
}
