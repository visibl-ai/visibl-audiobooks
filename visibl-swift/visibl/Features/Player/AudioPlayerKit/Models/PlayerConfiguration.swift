//
//  PlayerConfiguration.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

public struct PlayerConfiguration {
    public let playbackSpeed: Double
    public let seekInterval: TimeInterval
    public let updateInterval: TimeInterval
    public let highFrequencyUpdateInterval: TimeInterval

    // Buffering configuration
    public let preferredBufferDuration: TimeInterval
    public let enableBackgroundBuffering: Bool
    public let minimizeStalling: Bool

    public init(
        playbackSpeed: Double = 1.0,
        seekInterval: TimeInterval = 15.0,
        updateInterval: TimeInterval = 1.0,
        highFrequencyUpdateInterval: TimeInterval = 0.1,
        preferredBufferDuration: TimeInterval = 45.0,
        enableBackgroundBuffering: Bool = true,
        minimizeStalling: Bool = true
    ) {
        self.playbackSpeed = playbackSpeed
        self.seekInterval = seekInterval
        self.updateInterval = updateInterval
        self.highFrequencyUpdateInterval = highFrequencyUpdateInterval
        self.preferredBufferDuration = preferredBufferDuration
        self.enableBackgroundBuffering = enableBackgroundBuffering
        self.minimizeStalling = minimizeStalling
    }
}
