//
//  UploadManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseStorage
import Observation

@Observable final class UploadTaskModel: Identifiable {
    let id: String
    let fileURL: URL
    let destinationPath: String
    let fileName: String
    
    var progress: Double = 0
    var status: UploadStatus = .waiting
    var downloadURL: URL?
    var uploadTask: Task<Void, Never>?
    
    enum UploadStatus: Equatable {
        case waiting
        case uploading
        case completed
        case failed(Error)
        case cancelled
        
        static func == (lhs: UploadStatus, rhs: UploadStatus) -> Bool {
            switch (lhs, rhs) {
            case (.waiting, .waiting),
                 (.uploading, .uploading),
                 (.completed, .completed),
                 (.cancelled, .cancelled):
                return true
            case (.failed(let lhsError), .failed(let rhsError)):
                return (lhsError as NSError) == (rhsError as NSError)
            default:
                return false
            }
        }
    }
    
    init(
        id: String,
        fileURL: URL,
        destinationPath: String,
        fileName: String
    ) {
        self.id = id
        self.fileURL = fileURL
        self.destinationPath = destinationPath
        self.fileName = fileName
    }
}

final class UploadManager: ObservableObject {
    static let shared = UploadManager()
    
    @Published var tasks: [String: UploadTaskModel] = [:]
    private let cloudStorageManager = CloudStorageManager.shared
    
    private init() {}
    
    // MARK: - Public Interface
    
    func uploadFile(
        id: String,
        fileURL: URL,
        destinationPath: String,
        completion: ((Result<URL, Error>) -> Void)? = nil
    ) {
        guard !isUploading(id: id) else {
            completion?(.failure(UploadError.uploadAlreadyInProgress))
            return
        }
        
        let fileName = fileURL.lastPathComponent
        
        let task = UploadTaskModel(
            id: id,
            fileURL: fileURL,
            destinationPath: destinationPath,
            fileName: fileName
        )
        
        tasks[id] = task
        startUpload(task: task, completion: completion)
    }
    
    func cancelUpload(for id: String) {
        guard let task = tasks[id] else { return }
        
        // Cancel the actual upload task
        task.uploadTask?.cancel()
        task.uploadTask = nil
        
        task.status = .cancelled
        tasks.removeValue(forKey: id)
        
        print("Cancelled upload for \(id)")
    }
    
    func isUploading(id: String) -> Bool {
        guard let task = tasks[id] else { return false }
        switch task.status {
        case .waiting, .uploading:
            return true
        default:
            return false
        }
    }
    
    func getUploadProgress(for id: String) -> Double {
        return tasks[id]?.progress ?? 0.0
    }
    
    func getUploadStatus(for id: String) -> UploadTaskModel.UploadStatus {
        return tasks[id]?.status ?? .completed
    }
    
    func cancelAllUploads() {
        guard !tasks.isEmpty else {
            print("No active uploads to cancel")
            return
        }
        
        let taskCount = tasks.count
        print("Cancelling \(taskCount) active uploads...")
        
        for (_, task) in tasks {
            task.uploadTask?.cancel()
            task.uploadTask = nil
            task.status = .cancelled
        }
        
        tasks.removeAll()
        print("Successfully cancelled \(taskCount) uploads")
    }
    
    // MARK: - Private Implementation
    
    private func startUpload(
        task: UploadTaskModel,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        task.status = .uploading
        
        task.uploadTask = Task {
            do {
                // Check for cancellation before starting
                try Task.checkCancellation()
                
                let downloadURL = try await cloudStorageManager.uploadFileAsync(
                    from: task.fileURL,
                    to: task.destinationPath,
                    onProgress: { [weak self] progress in
                        Task { @MainActor in
                            // Check if task still exists and hasn't been cancelled
                            if let currentTask = self?.tasks[task.id], currentTask.status != .cancelled {
                                currentTask.progress = progress
                            }
                        }
                    }
                )
                
                // Check for cancellation before completing
                try Task.checkCancellation()
                
                await MainActor.run {
                    // Only complete if task hasn't been cancelled
                    if task.status != .cancelled {
                        task.status = .completed
                        task.downloadURL = downloadURL
                        task.progress = 1.0
                        self.tasks.removeValue(forKey: task.id)
                        completion?(.success(downloadURL))
                        // print("Upload completed for \(task.id): \(downloadURL.absoluteString)")
                    }
                }
                
            } catch {
                await MainActor.run {
                    // Check if error is due to cancellation
                    if error is CancellationError || task.status == .cancelled {
                        print("Upload cancelled for \(task.id)")
                        // Don't call completion for cancelled tasks
                    } else {
                        task.status = .failed(error)
                        self.tasks.removeValue(forKey: task.id)
                        completion?(.failure(error))
                        print("Upload failed for \(task.id): \(error.localizedDescription)")
                    }
                }
            }
        }

    }
}

// MARK: - Upload Errors

enum UploadError: LocalizedError {
    case uploadAlreadyInProgress
    case fileNotFound
    case invalidPath
    case uploadFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .uploadAlreadyInProgress:
            return "Upload already in progress for this file"
        case .fileNotFound:
            return "File not found at the specified path"
        case .invalidPath:
            return "Invalid destination path provided"
        case .uploadFailed(let message):
            return "Upload failed: \(message)"
        }
    }
}
