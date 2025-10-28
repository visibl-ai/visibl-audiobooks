//
//  SDDownloadManagerWrapper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import SDDownloadManager

final class SDDownloadManagerWrapper: ObservableObject {
    static let shared = SDDownloadManagerWrapper()
    
    @Published var tasks: [DownloadTaskModel] = []
    private let storageManager = StorageManager.shared
    
    // MARK: - Helper Methods for Array Operations
    
    private func findTask(by audiobookId: String) -> DownloadTaskModel? {
        tasks.first { $0.id == audiobookId }
    }
    
    private func removeTask(by audiobookId: String) {
        tasks.removeAll { $0.id == audiobookId }
    }
    
    // MARK: - Public Interface
    
    func downloadFile(
        id: String,
        url: URL,
        audiobookId: String,
        completion: ((Result<URL, Error>) -> Void)? = nil
    ) {
        guard !isDownloading(audiobookId: audiobookId) else {
            completion?(.failure(DownloadError.downloadAlreadyInProgress))
            return
        }
        
        checkStorageAndStartDownload(id: id, url: url, audiobookId: audiobookId, completion: completion)
    }
    
    func cancelDownload(for audiobookId: String) {
        guard let task = findTask(by: audiobookId), let downloadKey = task.downloadKey else { return }

        SDDownloadManager.shared.cancelDownload(forUniqueKey: downloadKey)
        task.status = .cancelled

        // Call the completion handler with a cancellation error to prevent continuation leak
        if let completion = task.completion {
            completion(.failure(DownloadError.cancelled))
            task.completion = nil
        }

        cleanupFailedDownload(audiobookId: audiobookId)
    }
    
    func isDownloading(audiobookId: String) -> Bool {
        return findTask(by: audiobookId) != nil
    }
    
    func getDownloadProgress(for audiobookId: String) -> Double {
        return findTask(by: audiobookId)?.progress ?? 0.0
    }
    
    func getDownloadStatus(for audiobookId: String) -> DownloadTaskModel.DownloadStatus {
        return findTask(by: audiobookId)?.status ?? .completed
    }
    
    func getStorageInfo() -> (availableMB: Double, totalActiveMB: Double) {
        let availableMB = storageManager.bytesToMB(storageManager.getAvailableSpace())
        let totalActiveMB = tasks.reduce(0) { $0 + $1.estimatedSizeMB }
        return (availableMB, totalActiveMB)
    }
    
    func cleanupCache() {
        storageManager.cleanupCacheDirectory()
    }
    
    func deleteAllFiles() throws {
        let fileManager = FileManager.default
        
        // Delete entire aax_files directory
        let aaxDir = fileManager.documentsDirectory
            .appendingPathComponent("aax_files")
        
        if fileManager.fileExists(atPath: aaxDir.path) {
            try fileManager.removeItem(at: aaxDir)
        }
        
        // Delete entire converted_books directory
        let convertedDir = fileManager.documentsDirectory
            .appendingPathComponent("converted_books")
        
        if fileManager.fileExists(atPath: convertedDir.path) {
            try fileManager.removeItem(at: convertedDir)
        }
    }
    
    // MARK: - Private Implementation
    
    private func checkStorageAndStartDownload(
        id: String,
        url: URL,
        audiobookId: String,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        storageManager.estimateFileSize(from: url) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                
                switch result {
                case .success(let sizeBytes):
                    self.handleSizeEstimation(
                        id: id,
                        sizeBytes: sizeBytes,
                        url: url,
                        audiobookId: audiobookId,
                        completion: completion
                    )
                case .failure:
                    self.handleSizeEstimationFailure(
                        id: id,
                        url: url,
                        audiobookId: audiobookId,
                        completion: completion
                    )
                }
            }
        }
    }
    
    private func handleSizeEstimation(
        id: String,
        sizeBytes: Int64,
        url: URL,
        audiobookId: String,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        let sizeMB = storageManager.bytesToMB(sizeBytes)
        let availableMB = storageManager.bytesToMB(storageManager.getAvailableSpace())
        
        guard storageManager.hasEnoughSpace(forSizeMB: sizeMB) else {
            let error = DownloadError.insufficientStorage(
                requiredMB: sizeMB + 100,
                availableMB: availableMB
            )
            completion?(.failure(error))
            return
        }
        
        let task = createDownloadTask(id: id, url: url, audiobookId: audiobookId, estimatedSizeMB: sizeMB, completion: completion)
        startDownload(task: task, audiobookId: audiobookId, completion: completion)
    }
    
    private func handleSizeEstimationFailure(
        id: String,
        url: URL,
        audiobookId: String,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        let availableMB = storageManager.bytesToMB(storageManager.getAvailableSpace())
        
        guard availableMB >= 300 else {
            let error = DownloadError.insufficientStorage(requiredMB: 200, availableMB: availableMB)
            completion?(.failure(error))
            return
        }
        
        let task = createDownloadTask(id: id, url: url, audiobookId: audiobookId, completion: completion)
        startDownload(task: task, audiobookId: audiobookId, completion: completion)
    }
    
    private func createDownloadTask(
        id: String,
        url: URL,
        audiobookId: String,
        estimatedSizeMB: Double = 200,
        completion: ((Result<URL, Error>) -> Void)? = nil
    ) -> DownloadTaskModel {
        let task = DownloadTaskModel(
            id: id,
            url: url,
            directoryName: "aax_files",
            fileName: audiobookId + ".aax",
            estimatedSizeMB: estimatedSizeMB
        )
        task.completion = completion
        tasks.append(task)
        return task
    }
    
    private func startDownload(
        task: DownloadTaskModel,
        audiobookId: String,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        let request = createDownloadRequest(for: task.url)
        configureSDDownloadManager()
        
        task.status = .downloading
        
        task.downloadKey = SDDownloadManager.shared.downloadFile(
            withRequest: request,
            inDirectory: task.directoryName,
            withName: task.fileName,
            shouldDownloadInBackground: true,
            onProgress: { [weak self] progress in
                self?.updateProgress(audiobookId: audiobookId, progress: progress)
            },
            onCompletion: { [weak self] error, url in
                // print("url \(url)")
                self?.handleDownloadCompletion(
                    audiobookId: audiobookId,
                    error: error,
                    url: url,
                    completion: completion
                )
            }
        )
    }
    
    private func createDownloadRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Audible/671 CFNetwork/1240.0.4 Darwin/20.6.0", forHTTPHeaderField: "User-Agent")
        return request
    }
    
    private func configureSDDownloadManager() {
        SDDownloadManager.shared.showLocalNotificationOnBackgroundDownloadDone = false
        // SDDownloadManager.shared.localNotificationText = "downloads_completed_notification_title".localized
    }
    
    private func updateProgress(audiobookId: String, progress: Double) {
        DispatchQueue.main.async { [weak self] in
            self?.findTask(by: audiobookId)?.progress = progress
        }
    }
    
    private func handleDownloadCompletion(
        audiobookId: String,
        error: Error?,
        url: URL?,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let task = self.findTask(by: audiobookId) else { return }
            
            if let error = error {
                self.handleDownloadError(audiobookId: audiobookId, task: task, error: error, completion: completion)
            } else if let downloadedURL = url {
                self.handleDownloadSuccess(audiobookId: audiobookId, task: task, downloadedURL: downloadedURL, completion: completion)
            } else {
                self.handleDownloadUnknownError(audiobookId: audiobookId, task: task, completion: completion)
            }
        }
    }
    
    private func handleDownloadError(
        audiobookId: String,
        task: DownloadTaskModel,
        error: Error,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        print("Error downloading \(audiobookId): \(error)")

        let customError = convertSystemError(error, estimatedSizeMB: task.estimatedSizeMB)
        task.status = .failed(customError)
        task.completion = nil  // Clear the stored completion handler
        cleanupFailedDownload(audiobookId: audiobookId)
        completion?(.failure(customError))
    }
    
    private func handleDownloadSuccess(
        audiobookId: String,
        task: DownloadTaskModel,
        downloadedURL: URL,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        print("Downloaded file for \(audiobookId) at: \(downloadedURL.path)")
        task.status = .moving

        moveFilesToDocuments(audiobookId: audiobookId) { [weak self] result in
            switch result {
            case .success(let movedURL):
                task.status = .completed
                task.completion = nil  // Clear the stored completion handler
                self?.removeTask(by: audiobookId)
                completion?(.success(movedURL))
            case .failure(let moveError):
                task.status = .failed(moveError)
                task.completion = nil  // Clear the stored completion handler
                self?.cleanupFailedDownload(audiobookId: audiobookId)
                completion?(.failure(moveError))
            }
        }
    }
    
    private func handleDownloadUnknownError(
        audiobookId: String,
        task: DownloadTaskModel,
        completion: ((Result<URL, Error>) -> Void)?
    ) {
        let unknownError = DownloadError.unknownError("Download completed but URL is nil")
        task.status = .failed(unknownError)
        task.completion = nil  // Clear the stored completion handler
        cleanupFailedDownload(audiobookId: audiobookId)
        completion?(.failure(unknownError))
    }
    
    private func convertSystemError(_ error: Error, estimatedSizeMB: Double) -> Error {
        guard let nsError = error as NSError? else {
            return DownloadError.unknownError(error.localizedDescription)
        }
        
        switch (nsError.domain, nsError.code) {
        case (NSPOSIXErrorDomain, 2), (NSPOSIXErrorDomain, 28):
            let availableMB = storageManager.bytesToMB(storageManager.getAvailableSpace())
            return DownloadError.insufficientStorage(
                requiredMB: estimatedSizeMB,
                availableMB: availableMB
            )
        default:
            return DownloadError.unknownError(error.localizedDescription)
        }
    }
    
    private func moveFilesToDocuments(
        audiobookId: String,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            
            do {
                try self.validateStorageForMove()
                let movedFiles = try self.performFileMove(audiobookId: audiobookId)
                let aaxFile = try self.findAAXFile(in: movedFiles)
                
                DispatchQueue.main.async {
                    print("Successfully moved \(movedFiles.count) files to Documents. Main file: \(aaxFile.path)")
                    completion(.success(aaxFile))
                }
            } catch {
                DispatchQueue.main.async {
                    completion(.failure(error))
                }
            }
        }
    }
    
    private func validateStorageForMove() throws {
        let availableSpace = storageManager.getAvailableSpace()
        guard availableSpace >= 50 * 1024 * 1024 else {
            throw DownloadError.insufficientStorage(
                requiredMB: 50,
                availableMB: storageManager.bytesToMB(availableSpace)
            )
        }
    }
    
    private func performFileMove(audiobookId: String) throws -> [URL] {
        return FileManager.default.moveAudiobookToDocuments(
            audiobookID: audiobookId,
            subfolder: "aax_files"
        )
    }
    
    private func findAAXFile(in movedFiles: [URL]) throws -> URL {
        guard let aaxFile = movedFiles.first(where: { $0.pathExtension.lowercased() == "aax" }) else {
            throw DownloadError.fileMoveFailed(reason: "AAX file not found in moved files")
        }
        return aaxFile
    }
    
    private func cleanupFailedDownload(audiobookId: String) {
        removeTask(by: audiobookId)
        
        DispatchQueue.global(qos: .utility).async {
            do {
                let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
                let aaxCacheDir = cacheDir.appendingPathComponent("aax_files")
                let targetFile = aaxCacheDir.appendingPathComponent(audiobookId + ".aax")
                
                if FileManager.default.fileExists(atPath: targetFile.path) {
                    try FileManager.default.removeItem(at: targetFile)
                    print("Cleaned up failed download file: \(targetFile.path)")
                }
            } catch {
                print("Error cleaning up failed download: \(error)")
            }
        }
    }
    
    func cancelAllDownloads() {
        guard !tasks.isEmpty else {
            print("No active downloads to cancel")
            return
        }
        
        let taskCount = tasks.count
        print("Cancelling \(taskCount) active downloads...")
        
        // Cancel each download and update status
        for task in tasks {
            if let downloadKey = task.downloadKey {
                SDDownloadManager.shared.cancelDownload(forUniqueKey: downloadKey)
            }
            task.status = .cancelled
        }
        
        // Clean up all tasks and their files
        let audiobookIds = tasks.map { $0.id }
        tasks.removeAll()
        
        // Clean up files in background
        DispatchQueue.global(qos: .utility).async { [weak self] in
            for audiobookId in audiobookIds {
                self?.cleanupDownloadFiles(audiobookId: audiobookId)
            }
            
            DispatchQueue.main.async {
                print("Successfully cancelled \(taskCount) downloads")
            }
        }
    }

    private func cleanupDownloadFiles(audiobookId: String) {
        do {
            let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
            let aaxCacheDir = cacheDir.appendingPathComponent("aax_files")
            let targetFile = aaxCacheDir.appendingPathComponent(audiobookId + ".aax")
            
            if FileManager.default.fileExists(atPath: targetFile.path) {
                try FileManager.default.removeItem(at: targetFile)
                print("Cleaned up cancelled download file: \(targetFile.path)")
            }
        } catch {
            print("Error cleaning up cancelled download for \(audiobookId): \(error)")
        }
    }
}
