//
//  ProcessingPhaseSpeech.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum ProcessingPhaseSpeech {
    case idle               // Not processing
    case creatingChunks     // Trimming/creating audio chunks
    case transcribing       // Performing speech recognition
    case completed          // Finished processing
}
