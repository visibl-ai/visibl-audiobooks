//
//  StorageManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class StorageManager {
    static let shared = StorageManager()
    
    private init() {}
    
    /// Get available storage space in bytes
    func getAvailableSpace() -> Int64 {
        do {
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            let attributes = try FileManager.default.attributesOfFileSystem(forPath: documentsPath.path)
            return attributes[.systemFreeSize] as? Int64 ?? 0
        } catch {
            print("Error getting available space: \(error)")
            return 0
        }
    }
    
    /// Convert bytes to MB
    func bytesToMB(_ bytes: Int64) -> Double {
        return Double(bytes) / (1024 * 1024)
    }
    
    /// Check if there's enough space for download (with buffer)
    func hasEnoughSpace(forSizeMB requiredMB: Double, bufferMB: Double = 100) -> Bool {
        let availableMB = bytesToMB(getAvailableSpace())
        return availableMB >= (requiredMB + bufferMB)
    }
    
    /// Estimate file size from URL (if possible)
    func estimateFileSize(from url: URL, completion: @escaping (Result<Int64, Error>) -> Void) {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.setValue("Audible/671 CFNetwork/1240.0.4 Darwin/20.6.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse,
               let contentLength = httpResponse.allHeaderFields["Content-Length"] as? String,
               let size = Int64(contentLength) {
                completion(.success(size))
            } else {
                // Default estimate for audiobooks (typically 100-500MB)
                completion(.success(200 * 1024 * 1024)) // 200MB default
            }
        }.resume()
    }
    
    /// Clean up cache directory
    func cleanupCacheDirectory() {
        DispatchQueue.global(qos: .utility).async {
            do {
                let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
                let aaxCacheDir = cacheDir.appendingPathComponent("aax_files")
                
                if FileManager.default.fileExists(atPath: aaxCacheDir.path) {
                    let contents = try FileManager.default.contentsOfDirectory(at: aaxCacheDir, includingPropertiesForKeys: nil)
                    for fileURL in contents {
                        try FileManager.default.removeItem(at: fileURL)
                    }
                    print("Cleaned up \(contents.count) files from cache")
                }
            } catch {
                print("Error cleaning cache: \(error)")
            }
        }
    }
}
