//
//  CloudStorageManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseStorage

final class CloudStorageManager: ObservableObject {
    static let shared = CloudStorageManager()
    
    private let storage = Storage.storage()
    
    func uploadFileAsync(
        from fileURL: URL,
        to path: String,
        metadata: StorageMetadata? = nil,
        onProgress: ((Double) -> Void)? = nil
    ) async throws -> URL {
        let storageRef = storage.reference().child(path)

        _ = try await storageRef.putFileAsync(
            from: fileURL,
            metadata: metadata,
            onProgress: { progress in
                guard let progress = progress else { return }
                let percentage = Double(progress.completedUnitCount) / Double(progress.totalUnitCount)
                onProgress?(percentage)
            }
        )

        return try await storageRef.downloadURL()
    }

    /// Upload file with cancellation support
    /// - Returns: StorageUploadTask that can be cancelled
    func uploadFile(
        from fileURL: URL,
        to path: String,
        metadata: StorageMetadata? = nil,
        onProgress: ((Double) -> Void)? = nil,
        completion: @escaping (Result<URL, Error>) -> Void
    ) -> StorageUploadTask {
        let storageRef = storage.reference().child(path)

        let uploadTask = storageRef.putFile(from: fileURL, metadata: metadata)

        uploadTask.observe(.progress) { snapshot in
            guard let progress = snapshot.progress else { return }
            let percentage = Double(progress.completedUnitCount) / Double(progress.totalUnitCount)
            onProgress?(percentage)
        }

        uploadTask.observe(.success) { _ in
            storageRef.downloadURL { url, error in
                if let error {
                    completion(.failure(error))
                } else if let url {
                    completion(.success(url))
                }
            }
        }

        uploadTask.observe(.failure) { snapshot in
            if let error = snapshot.error {
                completion(.failure(error))
            }
        }

        return uploadTask
    }
    
    func checkFileExists(at path: String) async throws -> URL? {
        let storageRef = storage.reference().child(path)
        let url = try await storageRef.downloadURL()
        return url
    }

    /// Downloads a file from Google Cloud Storage path to local temporary directory
    /// - Parameter gsPath: GCS path in format "gs://path/to/file.ext" (uses default bucket)
    /// - Returns: Local file URL where the file was downloaded
    func downloadFile(from gsPath: String) async throws -> URL {
        // Parse gs://path format
        guard gsPath.hasPrefix("gs://") else {
            throw NSError(domain: "CloudStorageManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid GCS path format"])
        }

        // Remove "gs://" prefix to get the path
        let path = String(gsPath.dropFirst(5)) // Remove "gs://"

        print("Downloading from path: \(path)")

        // Create storage reference using default bucket
        // Don't use reference(forURL:) as it requires full bucket URL
        let storageRef = storage.reference().child(path)

        // Create temp file URL
        let tempDir = FileManager.default.temporaryDirectory
        let fileName = (gsPath as NSString).lastPathComponent
        let localURL = tempDir.appendingPathComponent(fileName)

        // Remove existing file if any
        try? FileManager.default.removeItem(at: localURL)

        print("Downloading from GCS: \(gsPath)")
        print("To local path: \(localURL.path)")

        // Download file
        storageRef.write(toFile: localURL)

        print("Download completed: \(localURL.path)")
        
        return localURL
    }

    /// Deletes a file from Google Cloud Storage
    /// - Parameter gsPath: GCS path in format "gs://path/to/file.ext"
    func deleteFile(at gsPath: String) async throws {
        guard gsPath.hasPrefix("gs://") else {
            throw NSError(domain: "CloudStorageManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid GCS path format"])
        }

        let path = String(gsPath.dropFirst(5))
        print("Deleting from GCS: \(gsPath)")

        let storageRef = storage.reference().child(path)
        try await storageRef.delete()

        print("Deleted from GCS: \(gsPath)")
    }
}
