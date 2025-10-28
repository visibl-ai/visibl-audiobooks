//
//  DownloadTaskModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Observation

@Observable
final class DownloadTaskModel: Identifiable {
    let id: String
    let url: URL
    let directoryName: String
    let fileName: String
    let estimatedSizeMB: Double

    var downloadKey: String?
    var progress: Double = 0
    var status: DownloadStatus = .waiting
    var completion: ((Result<URL, Error>) -> Void)?
    
    enum DownloadStatus {
        case waiting
        case downloading
        case moving
        case completed
        case failed(Error)
        case cancelled
    }
    
    init(
        id: String,
        url: URL,
        directoryName: String,
        fileName: String,
        estimatedSizeMB: Double = 200
    ) {
        self.id = id
        self.url = url
        self.directoryName = directoryName
        self.fileName = fileName
        self.estimatedSizeMB = estimatedSizeMB
    }
}
