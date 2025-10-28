//
//  TestCase.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum TestCase: String, CaseIterable {
    case testAudiobookAdd
    case testAudiobookPlayPause
    
    var cmdLineArg: String {
        switch self {
        case .testAudiobookAdd: return "--testCase=\(rawValue)"
        case .testAudiobookPlayPause: return "--testCase=\(rawValue)"
        }
    }
}
