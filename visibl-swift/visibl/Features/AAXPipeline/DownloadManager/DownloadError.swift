//
//  DownloadError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum DownloadError: LocalizedError {
    case insufficientStorage(requiredMB: Double, availableMB: Double)
    case fileMoveFailed(reason: String)
    case downloadAlreadyInProgress
    case cancelled
    case unknownError(String)

    var errorDescription: String? {
        switch self {
        case .insufficientStorage(let required, let available):
            return "Insufficient storage space. Required: \(String(format: "%.1f", required))MB, Available: \(String(format: "%.1f", available))MB"
        case .fileMoveFailed(let reason):
            return "Failed to move downloaded file: \(reason)"
        case .downloadAlreadyInProgress:
            return "Download is already in progress for this audiobook"
        case .cancelled:
            return "Download was cancelled"
        case .unknownError(let message):
            return message
        }
    }
}
