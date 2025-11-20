//
//  PlayerWrapper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import AVFoundation
import Combine

public final class PlayerWrapper: NSObject, PlayerProtocol {
    
    // MARK: - Properties
    
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private let configuration: PlayerConfiguration
    
    // Time boundaries
    private var startTime: Double = 0
    private var endTime: Double?
    
    // Playback configuration
    private var shouldPlayWhenReady: Bool = false
    private var initialSeekPosition: TimeInterval?
    private var currentPlaybackSpeed: Double
    
    // Observers
    private var timeObserverToken: Any?
    private var highFreqTimeObserverToken: Any?
    private var statusObserver: NSKeyValueObservation?
    private var durationObserver: NSKeyValueObservation?
    private var rateObserver: NSKeyValueObservation?
    private var bufferEmptyObserver: NSKeyValueObservation?
    private var bufferLikelyToKeepUpObserver: NSKeyValueObservation?
    private var bufferFullObserver: NSKeyValueObservation?
    private var loadedTimeRangesObserver: NSKeyValueObservation?
    private var cancellables = Set<AnyCancellable>()
    private var customTimeObservers: [(token: Any, subject: PassthroughSubject<TimeInterval, Never>)] = []

    // Track if initial seek has completed to prevent emitting 0.0 during setup
    private var hasCompletedInitialSeek = false

    // Cache for preventing redundant updates
    private var lastEmittedTime: TimeInterval = -1
    private var lastEmittedHighFreqTime: TimeInterval = -1
    private let timeUpdateThreshold: TimeInterval = 0.01 // Only emit if changed by 10ms+

    // Background queue for time observer callbacks
    private let timeObserverQueue = DispatchQueue(label: "com.visibl.timeObserver", qos: .userInteractive)

    // Subjects
    private let isPlayingSubject = CurrentValueSubject<Bool, Never>(false)
    private let currentTimeSubject = PassthroughSubject<TimeInterval, Never>()
    private let durationSubject = CurrentValueSubject<TimeInterval, Never>(0)
    private let playbackFinishedSubject = PassthroughSubject<Void, Never>()
    private let highFrequencyTimeSubject = PassthroughSubject<TimeInterval, Never>()
    private let stateSubject = CurrentValueSubject<PlayerState, Never>(.idle)
    private let bufferingProgressSubject = CurrentValueSubject<Double, Never>(0)
    private let isBufferingSubject = CurrentValueSubject<Bool, Never>(false)
    
    // MARK: - Publishers
    
    public var isPlayingPublisher: AnyPublisher<Bool, Never> {
        isPlayingSubject.eraseToAnyPublisher()
    }
    
    public var timePublisher: AnyPublisher<TimeInterval, Never> {
        currentTimeSubject.eraseToAnyPublisher()
    }
    
    public var highFrequencyTimePublisher: AnyPublisher<TimeInterval, Never> {
        highFrequencyTimeSubject.eraseToAnyPublisher()
    }
    
    public var durationPublisher: AnyPublisher<TimeInterval, Never> {
        durationSubject.eraseToAnyPublisher()
    }
    
    public var playbackFinishedPublisher: AnyPublisher<Void, Never> {
        playbackFinishedSubject.eraseToAnyPublisher()
    }
    
    public var statePublisher: AnyPublisher<PlayerState, Never> {
        stateSubject.eraseToAnyPublisher()
    }

    public var bufferingProgressPublisher: AnyPublisher<Double, Never> {
        bufferingProgressSubject.eraseToAnyPublisher()
    }

    public var isBufferingPublisher: AnyPublisher<Bool, Never> {
        isBufferingSubject.eraseToAnyPublisher()
    }
    
    // MARK: - Initialization
    
    public init(configuration: PlayerConfiguration = PlayerConfiguration()) {
        self.configuration = configuration
        self.currentPlaybackSpeed = configuration.playbackSpeed
        super.init()
    }
    
    deinit {
        customTimeObservers.forEach {
            player?.removeTimeObserver($0.token)
            $0.subject.send(completion: .finished)
        }
        customTimeObservers.removeAll()
        cleanup()
    }
    
    // MARK: - Setup
    
    public func setupWithURL(
        with url: URL,
        startTime: Double? = nil,
        endTime: Double? = nil,
        playWhenReady: Bool? = nil,
        seek: Double? = nil
    ) {
        // Clean up any existing session
        cleanup()

        // Reset initial seek flag
        hasCompletedInitialSeek = false

        // Set loading state
        stateSubject.send(.loading)

        // Store time boundaries (convert Double to TimeInterval)
        self.startTime = TimeInterval(startTime ?? 0)
        self.endTime = endTime.map { TimeInterval($0) }

        // Store playback configuration for later use
        self.shouldPlayWhenReady = playWhenReady ?? false
        self.initialSeekPosition = seek.map { TimeInterval($0) }

        // Configure audio session
        configureAudioSession()

        // Create new player item and player
        let item = AVPlayerItem(url: url)
        self.playerItem = item
        self.player = AVPlayer(playerItem: item)

        // Configure buffering optimizations
        configureBuffering()

        // Setup all observers
        setupObservers()
        setupTimeObservers()
        setupNotifications()
    }
    
    // MARK: - Playback Controls
    
    public func play() {
        guard let player = player else { 
            stateSubject.send(.failed(PlayerError.loadingFailed(NSError(domain: "PlayerWrapper", code: -1, userInfo: [NSLocalizedDescriptionKey: "Player not initialized"]))))
            return 
        }
        
        // Check if player is ready
        guard playerItem?.status == .readyToPlay else {
            stateSubject.send(.loading)
            return
        }
        
        player.rate = Float(currentPlaybackSpeed)
        stateSubject.send(.playing)
    }
    
    public func pause() {
        player?.pause()
        stateSubject.send(.paused)
    }
    
    public func stop() {
        player?.pause()
        seek(to: 0)
        stateSubject.send(.idle)
        cleanup()
    }
    
    public func seek(to time: TimeInterval) {
        guard let player = player else { return }
        
        // Convert relative time to absolute time
        let absoluteTime = time + startTime
        
        // Ensure time is within bounds
        var boundedTime = max(startTime, absoluteTime)
        if let endTime = endTime {
            boundedTime = min(boundedTime, endTime)
        }
        
        let cmTime = CMTime(seconds: boundedTime, preferredTimescale: 600)
        player.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
    }
    
    public func seekBy(seconds: TimeInterval) {
        guard let player = player else { return }
        
        let currentTime = CMTimeGetSeconds(player.currentTime())
        guard currentTime.isFinite else { return }
        
        let newAbsoluteTime = currentTime + seconds
        let newRelativeTime = newAbsoluteTime - startTime
        
        seek(to: newRelativeTime)
    }
    
    public func seekForward() {
        seekBy(seconds: configuration.seekInterval)
    }
    
    public func seekBackward() {
        seekBy(seconds: -configuration.seekInterval)
    }
    
    public func setPlaybackSpeed(_ speed: Double) {
        let clampedSpeed = max(0.5, min(2.0, speed))
        currentPlaybackSpeed = clampedSpeed
        
        guard let player = player else { return }
        
        // Only apply the new rate if the player is currently playing
        // If paused (rate == 0), keep it paused and just store the speed
        if player.rate > 0 {
            player.rate = Float(clampedSpeed)
        }
    }
    
    // MARK: - Time Observation
    
    public func addPeriodicTimeUpdate(forInterval seconds: TimeInterval) -> AnyPublisher<TimeInterval, Never> {
        let subject = PassthroughSubject<TimeInterval, Never>()
        
        guard let player = player else {
            return subject.eraseToAnyPublisher()
        }
        
        let interval = CMTime(seconds: seconds, preferredTimescale: 600)
        let token = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main
        ) { [weak self, weak subject] time in
            guard let self = self,
                  let subject = subject else { return }
            
            let absoluteTime = CMTimeGetSeconds(time)
            guard absoluteTime.isFinite else { return }
            
            // Convert to relative time
            let relativeTime = max(0, absoluteTime - self.startTime)
            subject.send(relativeTime)
            
            // Check end boundary
            if let endTime = self.endTime, absoluteTime >= endTime {
                self.handleReachedEnd()
            }
        }
        
        customTimeObservers.append((token: token, subject: subject))
        
        return subject.eraseToAnyPublisher()
    }
    
    // MARK: - Private Methods
    
    private func cleanup() {
        // Remove time observers
        if let token = timeObserverToken, let player = player {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }

        if let token = highFreqTimeObserverToken, let player = player {
            player.removeTimeObserver(token)
            highFreqTimeObserverToken = nil
        }

        // Remove custom time observers
        if let player = player {
            for observer in customTimeObservers {
                player.removeTimeObserver(observer.token)
                observer.subject.send(completion: .finished)
            }
        }
        customTimeObservers.removeAll()

        // Invalidate KVO observers
        statusObserver?.invalidate()
        statusObserver = nil
        durationObserver?.invalidate()
        durationObserver = nil
        rateObserver?.invalidate()
        rateObserver = nil
        bufferEmptyObserver?.invalidate()
        bufferEmptyObserver = nil
        bufferLikelyToKeepUpObserver?.invalidate()
        bufferLikelyToKeepUpObserver = nil
        bufferFullObserver?.invalidate()
        bufferFullObserver = nil
        loadedTimeRangesObserver?.invalidate()
        loadedTimeRangesObserver = nil

        // Cancel subscriptions
        cancellables.removeAll()

        // Reset state to idle
        stateSubject.send(.idle)

        // Reset playback configuration
        shouldPlayWhenReady = false
        initialSeekPosition = nil

        // Reset cached time values
        lastEmittedTime = -1
        lastEmittedHighFreqTime = -1

        // Clean up player
        player = nil
        playerItem = nil
    }
    
    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            stateSubject.send(.failed(PlayerError.audioSessionFailed(error)))
        }
    }

    private func configureBuffering() {
        guard let player = player,
              let playerItem = playerItem else { return }

        // Configure AVPlayer buffering optimizations
        if configuration.minimizeStalling {
            player.automaticallyWaitsToMinimizeStalling = true
        }

        // Set preferred forward buffer duration (how much to buffer ahead)
        playerItem.preferredForwardBufferDuration = configuration.preferredBufferDuration

        // Enable background buffering
        if configuration.enableBackgroundBuffering {
            playerItem.canUseNetworkResourcesForLiveStreamingWhilePaused = true
        }

        // Configure aggressive preloading
        playerItem.preferredPeakBitRate = Double.infinity  // No limit on peak bit rate
        playerItem.preferredMaximumResolution = .zero  // No resolution limit for audio
    }
    
    private func setupObservers() {
        guard let playerItem = playerItem,
              let player = player else { return }
        
        // Status observer
        statusObserver = playerItem.observe(\.status, options: [.new, .initial]) { [weak self] item, _ in
            self?.handleStatusChange(item.status)
        }
        
        // Duration observer
        durationObserver = playerItem.observe(\.duration, options: [.new, .initial]) { [weak self] item, _ in
            self?.handleDurationChange(item.duration)
        }
        
        // Rate observer for play state
        rateObserver = player.observe(\.rate, options: [.new, .initial]) { [weak self] player, _ in
            DispatchQueue.main.async {
                self?.isPlayingSubject.send(player.rate != 0)
            }
        }

        // Buffer status observers
        bufferEmptyObserver = playerItem.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                if item.isPlaybackBufferEmpty {
                    self?.isBufferingSubject.send(true)
                    self?.stateSubject.send(.buffering)
                }
            }
        }

        bufferLikelyToKeepUpObserver = playerItem.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                if item.isPlaybackLikelyToKeepUp {
                    self?.isBufferingSubject.send(false)
                    // Resume previous state if was buffering
                    if self?.stateSubject.value == .buffering {
                        if self?.isPlayingSubject.value == true {
                            self?.stateSubject.send(.playing)
                        } else {
                            self?.stateSubject.send(.paused)
                        }
                    }
                }
            }
        }

        bufferFullObserver = playerItem.observe(\.isPlaybackBufferFull, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                // Buffer is completely full
                if item.isPlaybackBufferFull {
                    self?.bufferingProgressSubject.send(1.0)
                }
            }
        }

        // Monitor loaded time ranges for buffering progress
        loadedTimeRangesObserver = playerItem.observe(\.loadedTimeRanges, options: [.new]) { [weak self] item, _ in
            self?.updateBufferingProgress(for: item)
        }
    }
    
    private func setupTimeObservers() {
        guard let player = player else { return }

        // Standard time observer - moved to background queue
        let interval = CMTime(seconds: configuration.updateInterval, preferredTimescale: 600)
        
        timeObserverToken = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: DispatchQueue(label: "com.visibl.timeObserver.standard", qos: .userInteractive)
        ) { [weak self] time in
            self?.handleTimeUpdate(time, isHighFrequency: false)
        }

        // High frequency time observer - moved to background queue
        let highFreqInterval = CMTime(seconds: configuration.highFrequencyUpdateInterval, preferredTimescale: 600)
        highFreqTimeObserverToken = player.addPeriodicTimeObserver(
            forInterval: highFreqInterval,
            queue: DispatchQueue(label: "com.visibl.timeObserver.highFreq", qos: .userInteractive)
        ) { [weak self] time in
            self?.handleTimeUpdate(time, isHighFrequency: true)
        }
    }
    
    private func setupNotifications() {
        guard let playerItem = playerItem else { return }
        
        // Playback finished notification
        NotificationCenter.default
            .publisher(for: .AVPlayerItemDidPlayToEndTime, object: playerItem)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.handlePlaybackFinished()
            }
            .store(in: &cancellables)
        
        // Error notification
        NotificationCenter.default
            .publisher(for: .AVPlayerItemFailedToPlayToEndTime, object: playerItem)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                if let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error {
                    self?.stateSubject.send(.failed(PlayerError.playbackFailed(error)))
                }
                self?.handlePlaybackFinished()
            }
            .store(in: &cancellables)
    }
    
    private func handleStatusChange(_ status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            // Seek to initial position if specified, otherwise seek to start of chapter
            if let seekPosition = initialSeekPosition {
                seek(to: seekPosition)
                hasCompletedInitialSeek = true
            } else if startTime > 0 {
                seek(to: 0) // This will convert to absolute time internally
                hasCompletedInitialSeek = true
            } else {
                // No seeking needed, mark as ready immediately
                hasCompletedInitialSeek = true
            }

            // Auto-play if requested
            if shouldPlayWhenReady {
                play()
            } else {
                stateSubject.send(.paused)
            }
            
        case .failed:
            if let error = playerItem?.error {
                stateSubject.send(.failed(PlayerError.loadingFailed(error)))
            } else {
                stateSubject.send(.failed(PlayerError.loadingFailed(NSError(domain: "PlayerWrapper", code: -2, userInfo: [NSLocalizedDescriptionKey: "Unknown loading error"]))))
            }
            
        case .unknown:
            stateSubject.send(.loading)
            
        @unknown default:
            stateSubject.send(.loading)
        }
    }
    
    private func handleDurationChange(_ duration: CMTime) {
        let fullDuration = CMTimeGetSeconds(duration)
        guard fullDuration.isFinite && fullDuration > 0 else { return }
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Calculate effective duration based on time range
            let effectiveDuration = (self.endTime ?? fullDuration) - self.startTime
            self.durationSubject.send(max(0, effectiveDuration))
        }
    }
    
    private func handleTimeUpdate(_ time: CMTime, isHighFrequency: Bool) {
        let absoluteTime = CMTimeGetSeconds(time)
        guard absoluteTime.isFinite else { return }

        // Don't emit time updates before initial seek completes to prevent slideshow effect
        guard hasCompletedInitialSeek else { return }

        // Convert to relative time
        let relativeTime = max(0, absoluteTime - startTime)

        // Skip redundant updates - only emit if time changed meaningfully
        if isHighFrequency {
            guard abs(relativeTime - lastEmittedHighFreqTime) >= timeUpdateThreshold else { return }
            lastEmittedHighFreqTime = relativeTime
            DispatchQueue.main.async { [weak self] in
                self?.highFrequencyTimeSubject.send(relativeTime)
            }
        } else {
            guard abs(relativeTime - lastEmittedTime) >= timeUpdateThreshold else { return }
            lastEmittedTime = relativeTime
            DispatchQueue.main.async { [weak self] in
                self?.currentTimeSubject.send(relativeTime)
            }
        }

        // Check if we've reached the end (only on standard observer to avoid duplicate calls)
        if !isHighFrequency, let endTime = endTime, absoluteTime >= endTime {
            DispatchQueue.main.async { [weak self] in
                self?.handleReachedEnd()
            }
        }
    }
    
    private func handlePlaybackFinished() {
        pause()
        stateSubject.send(.finished)
        playbackFinishedSubject.send()
    }
    
    private func handleReachedEnd() {
        pause()
        stateSubject.send(.finished)
        playbackFinishedSubject.send()
    }

    private func updateBufferingProgress(for item: AVPlayerItem) {
        guard let timeRange = item.loadedTimeRanges.first?.timeRangeValue else {
            bufferingProgressSubject.send(0)
            return
        }

        let startSeconds = CMTimeGetSeconds(timeRange.start)
        let durationSeconds = CMTimeGetSeconds(timeRange.duration)
        let currentSeconds = CMTimeGetSeconds(item.currentTime())

        guard startSeconds.isFinite && durationSeconds.isFinite && currentSeconds.isFinite else {
            return
        }

        let bufferedSeconds = startSeconds + durationSeconds
        let totalDuration = CMTimeGetSeconds(item.duration)

        if totalDuration.isFinite && totalDuration > 0 {
            // Calculate progress as percentage of total duration buffered
            let progress = min(bufferedSeconds / totalDuration, 1.0)
            bufferingProgressSubject.send(progress)
        } else if currentSeconds > 0 {
            // Fallback: calculate how much ahead we've buffered from current position
            let bufferAhead = max(0, bufferedSeconds - currentSeconds)
            // Normalize to 0-1 based on preferred buffer duration
            let progress = min(bufferAhead / configuration.preferredBufferDuration, 1.0)
            bufferingProgressSubject.send(progress)
        }
    }
}

extension PlayerWrapper {
    /// Convenience method to connect a NowPlayingHandler to this player
    public func connectNowPlayingHandler(
        _ handler: NowPlayingHandler,
        metadata: NowPlayingMetadata
    ) {
        // Set initial metadata
        handler.updateMetadata(metadata)
        
        // Subscribe to playback updates
        Publishers.CombineLatest3(
            timePublisher,
            durationPublisher,
            isPlayingPublisher
        )
        .throttle(for: .seconds(1), scheduler: DispatchQueue.main, latest: true)
        .sink { [weak handler] currentTime, duration, isPlaying in
            handler?.updatePlaybackInfo(
                currentTime: currentTime,
                duration: duration,
                rate: isPlaying ? Float(self.configuration.playbackSpeed) : 0
            )
        }
        .store(in: &cancellables)
    }
}
