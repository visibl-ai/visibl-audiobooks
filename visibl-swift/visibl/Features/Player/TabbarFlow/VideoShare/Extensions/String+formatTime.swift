//
//  String+formatTime.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

extension String {
    static func formatTime(_ timeInterval: TimeInterval) -> String {
        guard timeInterval > 0 else { return "00:00" }
        
        let minutes = Int(timeInterval) / 60
        let seconds = Int(timeInterval) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
