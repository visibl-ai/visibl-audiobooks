//
//  SpeechClientConfiguration.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Speech

struct SpeechClientConfiguration {
    let locale: Locale
    let addsPunctuation: Bool
    let taskHint: SFSpeechRecognitionTaskHint
    let contextualStrings: [String]
    let requiresOnDeviceRecognition: Bool
}
