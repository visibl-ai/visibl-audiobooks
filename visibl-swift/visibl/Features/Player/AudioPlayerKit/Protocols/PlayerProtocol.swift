//
//  PlayerProtocol.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine

public protocol PlayerProtocol {
    // Publishers
    var statePublisher: AnyPublisher<PlayerState, Never> { get }
    var isPlayingPublisher: AnyPublisher<Bool, Never> { get }
    var timePublisher: AnyPublisher<TimeInterval, Never> { get }
    var durationPublisher: AnyPublisher<TimeInterval, Never> { get }
    var playbackFinishedPublisher: AnyPublisher<Void, Never> { get }
    
    // Setup
    func setupWithURL(
        with url: URL,
        startTime: Double?,
        endTime: Double?,
        playWhenReady: Bool?,
        seek: Double?
    )
    
    // Playback controls
    func play()
    func pause()
    func stop()
    func seek(to time: TimeInterval)
    func seekBy(seconds: TimeInterval)
    func seekForward()
    func seekBackward()
    
    // Time observation
    func addPeriodicTimeUpdate(forInterval seconds: TimeInterval) -> AnyPublisher<TimeInterval, Never>
}
