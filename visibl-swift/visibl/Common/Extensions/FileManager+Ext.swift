//
//  FileManager+Ext.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

extension FileManager {
    /// Documents directory URL
    var documentsDirectory: URL {
        urls(for: .documentDirectory, in: .userDomainMask).first!
    }
    
    /// Caches directory URL
    var cachesDirectory: URL {
        urls(for: .cachesDirectory, in: .userDomainMask).first!
    }
    
    @discardableResult
    func moveAudiobookToDocuments(
        audiobookID: String,
        subfolder: String
    ) -> [URL] {
        let destinationDirectory = documentsDirectory.appendingPathComponent(subfolder)
        var movedFiles: [URL] = []
        
        // Ensure destination directory exists
        try? createDirectory(at: destinationDirectory, withIntermediateDirectories: true, attributes: nil)
        
        // Move from Caches/aax_files (original AAX files)
        let aaxFilesDirectory = cachesDirectory.appendingPathComponent("aax_files")
        movedFiles.append(contentsOf: moveFiles(from: aaxFilesDirectory, to: destinationDirectory, containing: audiobookID))
        
        // Move from tmp (decoded audio files)
        movedFiles.append(contentsOf: moveFiles(from: temporaryDirectory, to: destinationDirectory, containing: audiobookID))
        
        return movedFiles
    }
    
    @discardableResult
    func deleteFileIfExists(at url: URL) -> Bool {
        guard fileExists(atPath: url.path) else {
            return true // File doesn't exist, consider it "deleted"
        }
        
        do {
            try removeItem(at: url)
            print("Deleted file: \(url.path)")
            return true
        } catch {
            print("Failed to delete file \(url.path): \(error)")
            return false
        }
    }
    
    // MARK: - Private Helper Methods
    
    private func moveFiles(from sourceDirectory: URL, to destinationDirectory: URL, containing id: String) -> [URL] {
        var movedFiles: [URL] = []
        
        guard let contents = try? contentsOfDirectory(atPath: sourceDirectory.path) else {
            return movedFiles
        }
        
        for fileName in contents where fileName.contains(id) {
            let sourceURL = sourceDirectory.appendingPathComponent(fileName)
            let destinationURL = destinationDirectory.appendingPathComponent(fileName)
            
            if moveFileSafely(from: sourceURL, to: destinationURL) {
                movedFiles.append(destinationURL)
            }
        }
        
        return movedFiles
    }
    
    private func moveFileSafely(from sourceURL: URL, to destinationURL: URL) -> Bool {
        do {
            // Remove destination file if it already exists
            if fileExists(atPath: destinationURL.path) {
                try removeItem(at: destinationURL)
            }
            
            try moveItem(at: sourceURL, to: destinationURL)
            print("Moved file from \(sourceURL.path) to \(destinationURL.path)")
            return true
        } catch {
            print("Failed to move file from \(sourceURL.path) to \(destinationURL.path): \(error)")
            return false
        }
    }
}
