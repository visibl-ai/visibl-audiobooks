//
//  VideoError.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum VideoError: Error {
    case noScenes
    case invalidImage
    case failedToCreateTracks
    case failedToCreateVideoWriter
    case failedToCreatePixelBuffer
    case failedToCreateContext
    case failedToCreateExportSession
    case exportFailed
    case localAudioFileNotFound
    case cancelled
}
