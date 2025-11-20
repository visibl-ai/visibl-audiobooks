//
//  AAXPipeline.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import AAXCPlayer

@MainActor final class AAXPipeline: ObservableObject {
    @Published var tasks: [AAXProcessingTaskModel] = []
    @Published var pendingAudiobookIds: [String] = []

    private var aaxClient: AAXClientWrapper
    private var authService: AuthServiceProtocol
    private var downloadManager: SDDownloadManagerWrapper
    private var transcriptionManager: TranscriptionManager
    private var uploadManager: UploadManager

    private var cancellables = Set<AnyCancellable>()
    private var progressTimers: [String: Timer] = [:]

    var onDownloadStateChanged: ((Bool) -> Void)?
    var getAudiobook: ((String) -> AudiobookModel?)?
    
    init(aaxClient: AAXClientWrapper, authService: AuthServiceProtocol) {
        self.aaxClient = aaxClient
        self.authService = authService
        self.downloadManager = .shared
        self.transcriptionManager = .shared
        self.uploadManager = .shared
    }
    
    // MARK: - Public Interface
    
    func startProcessing(
        _ audiobook: AudiobookModel
    ) async {
        if !audiobook.isAAX {
            return
        }

        let audiobookId = audiobook.id

        // Check if there's already an active task for this audiobook
        if tasks.contains(where: { $0.audiobookId == audiobookId }) {
            return
        }

        // Check if already in pending queue
        if pendingAudiobookIds.contains(audiobookId) {
            return
        }

        // If a task is already running, add to pending queue
        if !tasks.isEmpty {
            pendingAudiobookIds.append(audiobookId)
            objectWillChange.send()
            return
        }

        // Create new task
        let task = AAXProcessingTaskModel(
            id: UUID().uuidString,
            audiobookId: audiobook.id
        )

        tasks.append(task)
        task.startTime = Date()
        objectWillChange.send()

        // Start the processing pipeline
        await executeProcessingPipeline(audiobook: audiobook, task: task)
    }
    
    func cancelProcessing(taskId: String) {
        guard let taskIndex = tasks.firstIndex(where: { $0.id == taskId }) else { return }
        let task = tasks[taskIndex]

        // Only cancel download if this task has an active download with matching ID
        if let downloadId = task.downloadId,
           downloadId == task.audiobookId,
           downloadManager.isDownloading(audiobookId: downloadId) {
            downloadManager.cancelDownload(for: downloadId)
        }

        // Cancel upload if in progress
        uploadManager.cancelUpload(for: task.audiobookId)

        // Stop progress monitoring
        progressTimers[taskId]?.invalidate()
        progressTimers.removeValue(forKey: taskId)

        tasks.remove(at: taskIndex)
        objectWillChange.send()

        // Notify that download was cancelled
        onDownloadStateChanged?(false)

        // Process next book in queue
        Task {
            await processNextPendingBook()
        }
    }

    func cancelProcessingForAudiobook(audiobookId: String) {
        // Find task by audiobook ID and cancel it
        if let task = tasks.first(where: { $0.audiobookId == audiobookId }) {
            cancelProcessing(taskId: task.id)
        }
    }
    
    // Helper method to find task by audiobook ID
    func findTask(for audiobookId: String) -> AAXProcessingTaskModel? {
        tasks.first(where: { $0.audiobookId == audiobookId })
    }

    // Process next book in the queue
    private func processNextPendingBook() async {
        guard !pendingAudiobookIds.isEmpty else { return }
        guard tasks.isEmpty else { return }

        let nextAudiobookId = pendingAudiobookIds.removeFirst()
        objectWillChange.send()

        // Get the audiobook from the callback
        guard let audiobook = getAudiobook?(nextAudiobookId) else {
            print("⚠️ Could not find audiobook with ID: \(nextAudiobookId)")
            // Try next one in queue
            await processNextPendingBook()
            return
        }

        // Create and start new task
        let task = AAXProcessingTaskModel(
            id: UUID().uuidString,
            audiobookId: audiobook.id
        )

        tasks.append(task)
        task.startTime = Date()
        objectWillChange.send()

        // Start the processing pipeline
        await executeProcessingPipeline(audiobook: audiobook, task: task)
    }
    
    // MARK: - Processing Pipeline

    private func retry<T>(maxAttempts: Int = 3, operation: () async throws -> T) async throws -> T {
        var lastError: Error?

        for attempt in 1...maxAttempts {
            do {
                return try await operation()
            } catch {
                lastError = error
                print("⚠️ Attempt \(attempt) failed: \(error.localizedDescription)")

                if attempt < maxAttempts {
                    print("🔄 Retrying... (\(attempt + 1)/\(maxAttempts))")
                    try await Task.sleep(nanoseconds: 3_000_000_000) // 3 second delay
                }
            }
        }

        throw lastError ?? AAXProcessingError.downloadFailed("Unknown error")
    }

    private func executeProcessingPipeline(audiobook: AudiobookModel, task: AAXProcessingTaskModel) async {
        // Check if upload will be needed
        let hasProgress = (audiobook.graphProgress?.progress ?? 0) > 0
        let uploadedOnCloud = await audiobook.isUploadedOnCloud()
        let needsUpload = !uploadedOnCloud && !hasProgress

        // Configure the task
        task.setNeedsUpload(needsUpload)

        do {
            var aaxInfo: AAXInfoModel?

            // Step 1: Download with retry
            if !audiobook.isDownloaded {
                // Notify that download is starting
                onDownloadStateChanged?(true)

                aaxInfo = try await retry {
                    try await self.downloadAAXFile(audiobook: audiobook, task: task)
                }
            } else {
                print("⏩ AAX file already downloaded, skipping download")
            }

            // Step 2: Convert with retry
            if !audiobook.isAAXFileConverted {
                try await retry {
                    try await self.convertAAXFile(audiobook: audiobook, aaxInfo: aaxInfo, task: task)
                }
            } else {
                print("⏩ AAX file already converted, skipping conversion")
            }

            if needsUpload {
                print("🎌 isUploadedOnCloud \(uploadedOnCloud), hasProgress \(hasProgress)")

                // Step 3: Upload File to Bucket with retry
                try await retry {
                    try await self.uploadFile(audiobook: audiobook, task: task)
                }
            } else {
                print("📁 File does not need to be uploaded on cloud, skipping upload")
            }

            // Step 4: Request Processing with retry
            if audiobook.graphProgress?.progress == 0 || audiobook.graphProgress == nil {
                try await retry {
                    try await AAXService.requestDownloadedBookProcessing(sku: audiobook.id)
                }
            }

            // Mark task as completed
            task.setCompleted()

            // Notify that download is completed
            onDownloadStateChanged?(false)

            // Remove task after completion
            if let index = tasks.firstIndex(where: { $0.id == task.id }) {
                tasks.remove(at: index)
                objectWillChange.send()
            }

            // Process next book in queue
            await processNextPendingBook()

        } catch {
            _ = task.status.currentStep ?? .download
            print("❌ Processing failed for \(audiobook.title) after all retries: \(error.localizedDescription)")

            // Notify that download failed/stopped
            onDownloadStateChanged?(false)

            // Remove failed task
            if let index = tasks.firstIndex(where: { $0.id == task.id }) {
                tasks.remove(at: index)
                objectWillChange.send()
            }

            // Process next book in queue
            await processNextPendingBook()
        }
    }
    
    // MARK: - Download Progress Monitoring
    
    private func startDownloadProgressMonitoring(taskId: String, task: AAXProcessingTaskModel) {
        progressTimers[taskId] = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                // Check if task still exists in array
                guard self.tasks.contains(where: { $0.id == task.id }) else {
                    self.progressTimers[taskId]?.invalidate()
                    self.progressTimers.removeValue(forKey: taskId)
                    return
                }
                let progress = self.downloadManager.getDownloadProgress(for: task.audiobookId)
                task.updateDownloadProgress(progress)
                // Manually trigger objectWillChange when progress updates
                self.objectWillChange.send()
            }
        }
    }
    
    // MARK: - Upload Progress Monitoring
    
    private func startUploadProgressMonitoring(taskId: String, task: AAXProcessingTaskModel) {
        progressTimers[taskId] = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                // Check if task still exists in array
                guard self.tasks.contains(where: { $0.id == task.id }) else {
                    self.progressTimers[taskId]?.invalidate()
                    self.progressTimers.removeValue(forKey: taskId)
                    return
                }
                let progress = self.uploadManager.getUploadProgress(for: task.audiobookId)
                task.updateUploadProgress(progress)
                // Manually trigger objectWillChange when progress updates
                self.objectWillChange.send()
            }
        }
    }
}

// MARK: - Downloading

private extension AAXPipeline {
    func downloadAAXFile(audiobook: AudiobookModel, task: AAXProcessingTaskModel) async throws -> AAXInfoModel {
        // Get download info
        let downloadInfo = try await aaxClient.getAAXDownloadInfo(id: audiobook.id)
        let newAAXInfo: AAXInfoModel = .init(key: downloadInfo.key, iv: downloadInfo.iv)
        audiobook.updateAAXInfo(newAAXInfo)
        
        // Store download ID in task
        task.downloadId = audiobook.id
        
        // Start monitoring download progress
        startDownloadProgressMonitoring(taskId: task.id, task: task)
        
        // Download file
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            downloadManager.downloadFile(
                id: audiobook.id,
                url: URL(string: downloadInfo.url)!,
                audiobookId: audiobook.id
            ) { result in
                switch result {
                case .success:
                    continuation.resume()
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
        
        // Stop progress monitoring
        progressTimers[task.id]?.invalidate()
        progressTimers.removeValue(forKey: task.id)
        
        // Submit metadata
        try await submitMetadata(
            id: audiobook.id,
            aaxFilePath: audiobook.aaxFilePath,
            key: newAAXInfo.key,
            iv: newAAXInfo.iv
        )
        
        return newAAXInfo
    }
}

// MARK: - Uploading

private extension AAXPipeline {
    func uploadFile(audiobook: AudiobookModel, task: AAXProcessingTaskModel) async throws {
        guard let userID = authService.getUserID() else {
            throw AAXProcessingError.noUserSignedIn
        }

        // Validate and reconvert if needed
        try await validateAndReconvertIfNeeded(audiobook: audiobook, task: task)

        let path = "UserData/\(userID)/Uploads/Raw/\(audiobook.id).m4b"

        print("🪣 Bucket path: \(path)")

        // Start monitoring upload progress
        startUploadProgressMonitoring(taskId: task.id, task: task)
        
        // Upload file
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            uploadManager.uploadFile(
                id: audiobook.id,
                fileURL: audiobook.convertedAAXFileURL,
                destinationPath: path
            ) { result in
                switch result {
                case .success(let url):
                    print("Upload completed for \(audiobook.title): \(url.absoluteString)")
                    continuation.resume()
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
        
        // Stop progress monitoring
        progressTimers[task.id]?.invalidate()
        progressTimers.removeValue(forKey: task.id)
    }

    private func validateAndReconvertIfNeeded(audiobook: AudiobookModel, task: AAXProcessingTaskModel) async throws {
        let isCorrupted = try isConvertedFileCorrupted(audiobook: audiobook)

        if isCorrupted {
            print("🔄 File was corrupted, reconverting...")
            try await convertAAXFile(audiobook: audiobook, aaxInfo: nil, task: task)

            // Validate again after reconversion
            let stillCorrupted = try isConvertedFileCorrupted(audiobook: audiobook)
            if stillCorrupted {
                throw AAXProcessingError.uploadFailed("Reconversion also produced corrupted file")
            }
        }
    }

    private func isConvertedFileCorrupted(audiobook: AudiobookModel) throws -> Bool {
        let originalURL = URL(fileURLWithPath: audiobook.aaxFilePath)
        let convertedURL = audiobook.convertedAAXFileURL

        guard FileManager.default.fileExists(atPath: originalURL.path) else {
            throw AAXProcessingError.uploadFailed("Original file not found")
        }

        guard FileManager.default.fileExists(atPath: convertedURL.path) else {
            throw AAXProcessingError.uploadFailed("Converted file not found")
        }

        let originalSize = try getFileSize(url: originalURL)
        let convertedSize = try getFileSize(url: convertedURL)

        let tolerance: Double = 0.05 // 5%
        let lowerBound = Double(originalSize) * (1.0 - tolerance)
        let upperBound = Double(originalSize) * (1.0 + tolerance)

        print("📊 Original: \(originalSize) bytes, Converted: \(convertedSize) bytes")
        print("📊 Valid range: \(Int64(lowerBound)) - \(Int64(upperBound)) bytes")

        let isValid = Double(convertedSize) >= lowerBound && Double(convertedSize) <= upperBound

        if isValid {
            print("✅ File size validation passed")
            return false
        } else {
            let percentageDiff = abs(Double(convertedSize - originalSize) / Double(originalSize)) * 100
            print("⚠️ File corrupted: \(String(format: "%.1f", percentageDiff))% size difference")
            print("🗑️ Deleting corrupted file")
            try? FileManager.default.removeItem(at: convertedURL)
            return true
        }
    }

    private func getFileSize(url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? Int64 else {
            throw AAXProcessingError.uploadFailed("Unable to read file size")
        }
        return size
    }
}

// MARK: - Conversion and Metadata Submission

private extension AAXPipeline {
    private func convertAAXFile(audiobook: AudiobookModel, aaxInfo: AAXInfoModel? = nil, task: AAXProcessingTaskModel) async throws {
        task.setConverting()
        
        // Use the passed aaxInfo if available, otherwise use the one from audiobook
        let effectiveAAXInfo = aaxInfo ?? audiobook.aaxInfo
        
        guard let aaxInfo = effectiveAAXInfo,
              let keyData = aaxInfo.key.hexData(),
              let ivData = aaxInfo.iv.hexData() else {
            throw AAXProcessingError.invalidAAXInfo
        }
        
        // Perform conversion on background queue
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            Task.detached {
                do {
                    try FileManager.default.createDirectory(
                        at: audiobook.convertedAAXFileURL.deletingLastPathComponent(),
                        withIntermediateDirectories: true,
                        attributes: nil
                    )
                    
                    var player: AAXCSelectivePlayer? = try AAXCSelectivePlayer(
                        key: keyData,
                        iv: ivData,
                        inputPath: audiobook.aaxFilePath
                    )
                    
                    defer {
                        player?.close()
                        player = nil
                    }
                    
                    try player?.convertToM4A(outputPath: audiobook.convertedAAXFilePath)
                    
                    await MainActor.run {
                        task.setConvertCompleted()
                    }
                    
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    private func submitMetadata(id: String, aaxFilePath: String, key: String, iv: String) async throws {
        try await aaxClient.submitMetadata(
            id: id,
            aaxFilePath: aaxFilePath,
            keyHex: key,
            ivHex: iv
        )
    }
}

// MARK: - On Device Transcribing

private extension AAXPipeline {
    func transcribeOnDevice(audiobook: AudiobookModel) async throws {
        guard !audiobook.hasGraph else {
            // If graph already exists, skip transcription
            print("Graph already exists for \(audiobook.id), skipping transcription")
            return
        }
        
        try await transcriptionManager.startTranscription(for: audiobook.userLibraryItem)
    }
}

// MARK: - Cancel All for Sign Out

extension AAXPipeline {
    func cancelAllTasks() {
        // Get all tasks except the first one (which is likely the current task)
        let pendingTasks = tasks.dropFirst()
        let pendingTaskIds = pendingTasks.map { $0.id }

        // Only cancel pending tasks, not the current one
        for taskId in pendingTaskIds {
            cancelProcessing(taskId: taskId)
        }

        uploadManager.cancelAllUploads()
        transcriptionManager.cancelAllTranscriptions()
    }
}
