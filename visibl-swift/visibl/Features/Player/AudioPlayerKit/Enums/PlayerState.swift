//
//  PlayerState.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

public enum PlayerState: Equatable {
    case idle
    case loading
    case playing
    case paused
    case buffering
    case failed(PlayerError)
    case finished
    
    // Custom Equatable implementation to handle PlayerError case
    public static func == (lhs: PlayerState, rhs: PlayerState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle),
             (.loading, .loading),
             (.playing, .playing),
             (.paused, .paused),
             (.buffering, .buffering),
             (.finished, .finished):
            return true
        case (.failed(let lhsError), .failed(let rhsError)):
            return lhsError.localizedDescription == rhsError.localizedDescription
        default:
            return false
        }
    }
    
    public var isActive: Bool {
        switch self {
        case .playing, .buffering:
            return true
        default:
            return false
        }
    }
    
    public var isPlayable: Bool {
        switch self {
        case .playing, .paused:
            return true
        default:
            return false
        }
    }
}
