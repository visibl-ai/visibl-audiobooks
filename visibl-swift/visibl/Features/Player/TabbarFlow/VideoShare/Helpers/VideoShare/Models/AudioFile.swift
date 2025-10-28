//
//  AudioFile.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct AudioFile {
    let localURL: URL
    let gcsPath: String?  // nil for local files, present for downloaded clips
}
