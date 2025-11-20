//
//  RemoteCommandHandler.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import MediaPlayer

public protocol RemoteCommandDelegate: AnyObject {
    func remoteCommandPlay() -> MPRemoteCommandHandlerStatus
    func remoteCommandPause() -> MPRemoteCommandHandlerStatus
    func remoteCommandTogglePlayPause() -> MPRemoteCommandHandlerStatus
    func remoteCommandNextTrack() -> MPRemoteCommandHandlerStatus
    func remoteCommandPreviousTrack() -> MPRemoteCommandHandlerStatus
    func remoteCommandSeekForward() -> MPRemoteCommandHandlerStatus
    func remoteCommandSeekBackward() -> MPRemoteCommandHandlerStatus
    func remoteCommandChangePlaybackPosition(to position: TimeInterval) -> MPRemoteCommandHandlerStatus
}

// Default implementations
public extension RemoteCommandDelegate {
    func remoteCommandNextTrack() -> MPRemoteCommandHandlerStatus { .commandFailed }
    func remoteCommandPreviousTrack() -> MPRemoteCommandHandlerStatus { .commandFailed }
    func remoteCommandSeekForward() -> MPRemoteCommandHandlerStatus { .commandFailed }
    func remoteCommandSeekBackward() -> MPRemoteCommandHandlerStatus { .commandFailed }
}

public final class RemoteCommandHandler {
    // MARK: - Properties
    
    public weak var delegate: RemoteCommandDelegate?
    private let commandCenter = MPRemoteCommandCenter.shared()
    private var registeredCommands: [Any] = []
    
    // MARK: - Configuration
    
    public struct Configuration {
        public let playPauseEnabled: Bool
        public let nextPreviousEnabled: Bool
        public let seekEnabled: Bool
        public let changePlaybackPositionEnabled: Bool
        public let seekForwardInterval: TimeInterval
        public let seekBackwardInterval: TimeInterval

        public init(
            playPauseEnabled: Bool = true,
            nextPreviousEnabled: Bool = false,
            seekEnabled: Bool = true,
            changePlaybackPositionEnabled: Bool = true,
            seekForwardInterval: TimeInterval = 30.0,
            seekBackwardInterval: TimeInterval = 15.0
        ) {
            self.playPauseEnabled = playPauseEnabled
            self.nextPreviousEnabled = nextPreviousEnabled
            self.seekEnabled = seekEnabled
            self.changePlaybackPositionEnabled = changePlaybackPositionEnabled
            self.seekForwardInterval = seekForwardInterval
            self.seekBackwardInterval = seekBackwardInterval
        }
    }
    
    // MARK: - Initialization
    
    public init(configuration: Configuration = Configuration()) {
        setupCommands(with: configuration)
    }
    
    deinit {
        cleanup()
    }
    
    // MARK: - Setup
    
    private func setupCommands(with configuration: Configuration) {
        // Play/Pause commands
        if configuration.playPauseEnabled {
            registeredCommands.append(
                commandCenter.playCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandPlay() ?? .noSuchContent
                }
            )
            
            registeredCommands.append(
                commandCenter.pauseCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandPause() ?? .noSuchContent
                }
            )
            
            registeredCommands.append(
                commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandTogglePlayPause() ?? .noSuchContent
                }
            )
        }
        
        // Next/Previous commands
        if configuration.nextPreviousEnabled {
            registeredCommands.append(
                commandCenter.nextTrackCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandNextTrack() ?? .noSuchContent
                }
            )
            
            registeredCommands.append(
                commandCenter.previousTrackCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandPreviousTrack() ?? .noSuchContent
                }
            )
        } else {
            commandCenter.nextTrackCommand.isEnabled = false
            commandCenter.previousTrackCommand.isEnabled = false
        }
        
        // Seek commands
        if configuration.seekEnabled {
            // Configure skip forward command
            let skipForwardCommand = commandCenter.skipForwardCommand
            skipForwardCommand.preferredIntervals = [NSNumber(value: configuration.seekForwardInterval)]
            registeredCommands.append(
                skipForwardCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandSeekForward() ?? .noSuchContent
                }
            )

            // Configure skip backward command
            let skipBackwardCommand = commandCenter.skipBackwardCommand
            skipBackwardCommand.preferredIntervals = [NSNumber(value: configuration.seekBackwardInterval)]
            registeredCommands.append(
                skipBackwardCommand.addTarget { [weak self] _ in
                    self?.delegate?.remoteCommandSeekBackward() ?? .noSuchContent
                }
            )
        } else {
            commandCenter.skipForwardCommand.isEnabled = false
            commandCenter.skipBackwardCommand.isEnabled = false
        }
        
        // Change playback position
        if configuration.changePlaybackPositionEnabled {
            registeredCommands.append(
                commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
                    guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                        return .commandFailed
                    }
                    return self?.delegate?.remoteCommandChangePlaybackPosition(to: event.positionTime) ?? .noSuchContent
                }
            )
        } else {
            commandCenter.changePlaybackPositionCommand.isEnabled = false
        }
    }
    
    // MARK: - Cleanup
    
    private func cleanup() {
        // Remove all command targets
        commandCenter.playCommand.removeTarget(nil)
        commandCenter.pauseCommand.removeTarget(nil)
        commandCenter.togglePlayPauseCommand.removeTarget(nil)
        commandCenter.nextTrackCommand.removeTarget(nil)
        commandCenter.previousTrackCommand.removeTarget(nil)
        commandCenter.skipForwardCommand.removeTarget(nil)
        commandCenter.skipBackwardCommand.removeTarget(nil)
        commandCenter.changePlaybackPositionCommand.removeTarget(nil)
        
        registeredCommands.removeAll()
    }
    
    // MARK: - Dynamic Configuration
    
    public func setNextPreviousEnabled(_ enabled: Bool) {
        commandCenter.nextTrackCommand.isEnabled = enabled
        commandCenter.previousTrackCommand.isEnabled = enabled
    }
    
    public func setSeekEnabled(_ enabled: Bool) {
        commandCenter.skipForwardCommand.isEnabled = enabled
        commandCenter.skipBackwardCommand.isEnabled = enabled
    }
}
