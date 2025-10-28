//
//  ChunkInfo.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct ChunkInfo {
    let chunkIndex: Int
    let url: URL?
    let actualStartTime: Double  // Start time with overlap
    let actualEndTime: Double    // End time with overlap
    let baseStartTime: Double    // Original start time without overlap
    let baseEndTime: Double      // Original end time without overlap
} 
