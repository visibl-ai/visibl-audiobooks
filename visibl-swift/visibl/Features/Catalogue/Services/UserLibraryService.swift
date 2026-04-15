//
//  UserLibraryService.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct UserLibraryService {
    static func addAudiobookToUserLibrary(sku: String) async throws {
        try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
            includeRawData: false,
            functionName: "v1addItemToLibrary",
            with: ["sku": sku]
        )
    }
}
