//
//  ImageDownloadManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import UIKit
import Kingfisher

enum ImageDownloadManagerError: Error {
    case invalidURL
    case downloadFailed
    case saveFailed
}

final class ImageDownloadManager {
    static let shared = ImageDownloadManager()
    
    private func downloadAndSaveImage(from urlString: String) async throws -> URL {
        guard let url = URL(string: urlString) else {
            throw ImageDownloadManagerError.invalidURL
        }
        
        let image = try await downloadImage(from: url)
        return try await saveImage(image, withPath: url.path)
    }
    
    private func downloadImage(from url: URL) async throws -> UIImage {
        let (data, _) = try await URLSession.shared.data(from: url)
        
        guard let image = UIImage(data: data) else {
            throw ImageDownloadManagerError.downloadFailed
        }
        
        return image
    }
    
    private func saveImage(_ image: UIImage, withPath path: String) async throws -> URL {
        let fileManager = FileManager.default
        
        guard let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw ImageDownloadManagerError.saveFailed
        }
        
        let fullPath = documentsDirectory.appendingPathComponent(path)
        
        try fileManager.createDirectory(at: fullPath.deletingLastPathComponent(), withIntermediateDirectories: true)
        
        guard let data = image.jpegData(compressionQuality: 1.0) else {
            throw ImageDownloadManagerError.saveFailed
        }
        
        try data.write(to: fullPath)
        
        return fullPath
    }
}

extension ImageDownloadManager {
    func getImage(from urlString: String) async -> UIImage? {
        if let localURL = getLocalImageURL(for: urlString) {
            return UIImage(contentsOfFile: localURL.path)
        } else {
            let image = await downloadImageToLocalWithUIImage(from: urlString)
            return image
        }
    }
}

extension ImageDownloadManager {
    private func downloadImageToLocalWithUIImage(from urlString: String) async -> UIImage? {
        do {
            let savedImageURL = try await ImageDownloadManager.shared.downloadAndSaveImage(from: urlString)
            // print(urlString)
            // print("Image downloaded and saved successfully at: \(savedImageURL.path)")
            return UIImage(contentsOfFile: savedImageURL.path)
        } catch {
            print("Error downloading and saving image: \(error)")
            return nil
        }
    }
}

extension ImageDownloadManager {
    private func downloadImageToLocalWithURL(from urlString: String) async -> URL? {
        do {
            let savedImageURL = try await ImageDownloadManager.shared.downloadAndSaveImage(from: urlString)
            // print("Image downloaded and saved successfully at: \(savedImageURL.path)")
            return savedImageURL
        } catch {
            print("Error downloading and saving image: \(error)")
            return URL(string: urlString)
        }
    }
}

extension ImageDownloadManager {
    private func getLocalImageURL(for remoteURL: String) -> URL? {
        guard let url = URL(string: remoteURL) else {
            return nil
        }
        
        let fileManager = FileManager.default
        guard let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        
        let localURL = documentsDirectory.appendingPathComponent(url.path)
        
        return fileManager.fileExists(atPath: localURL.path) ? localURL : nil
    }
}
