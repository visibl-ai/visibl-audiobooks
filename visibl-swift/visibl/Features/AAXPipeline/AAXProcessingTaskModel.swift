//
//  AAXProcessingTaskModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Observation

enum AAXProcessingStep: String, CaseIterable {
    case download, convert, upload
}

enum AAXProcessingStatus {
    case waiting
    case downloading(progress: Double)
    case converting
    case uploading(progress: Double)
    case completed
    
    var currentStep: AAXProcessingStep? {
        switch self {
        case .downloading: return .download
        case .converting: return .convert
        case .uploading: return .upload
        default: return nil
        }
    }
    
    var isActive: Bool {
        switch self {
        case .downloading, .converting, .uploading:
            return true
        default:
            return false
        }
    }
}

@Observable
final class AAXProcessingTaskModel: Identifiable, @unchecked Sendable {
    let id: String
    let audiobookId: String
    
    var status: AAXProcessingStatus = .waiting
    var overallProgress: Double = 0.0
    var startTime: Date?
    var completionTime: Date?
    
    // Internal tracking
    var downloadId: String?
    var transcriptionTaskId: String?
    
    // Step-specific progress
    private var downloadProgress: Double = 0.0
    private var uploadProgress: Double = 0.0
    
    // Track which steps are needed
    private var needsUpload: Bool = true
    
    init(
        id: String,
        audiobookId: String
    ) {
        self.id = id
        self.audiobookId = audiobookId
    }
    
    // Call this to configure if upload is needed
    func setNeedsUpload(_ needs: Bool) {
        self.needsUpload = needs
        if !needs {
            uploadProgress = 1.0
        }
        updateOverallProgress()
    }
    
    func updateDownloadProgress(_ progress: Double) {
        downloadProgress = progress
        status = .downloading(progress: progress)
        updateOverallProgress()
    }
    
    func setConverting() {
        status = .converting
        updateOverallProgress()
    }
    
    func setConvertCompleted() {
        updateOverallProgress()
    }
    
    func updateUploadProgress(_ progress: Double) {
        uploadProgress = progress
        status = .uploading(progress: progress)
        updateOverallProgress()
    }
    
    func setCompleted() {
        status = .completed
        overallProgress = 1.0
        completionTime = Date()
    }
    
    private func updateOverallProgress() {
        if needsUpload {
            // If upload is needed: download 50%, upload 50%
            overallProgress = (downloadProgress * 0.5) + (uploadProgress * 0.5)
        } else {
            // If no upload needed: download is 100%
            overallProgress = downloadProgress
        }
        
        // Ensure we never exceed 1.0
        overallProgress = min(overallProgress, 1.0)
    }
}
