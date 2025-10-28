//
//  ChunkingStrategySpeech.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum ChunkingStrategySpeech {
    case sequential  // Create chunk -> transcribe -> create next chunk (current)
    case batch       // Create all chunks first -> then transcribe all
}
