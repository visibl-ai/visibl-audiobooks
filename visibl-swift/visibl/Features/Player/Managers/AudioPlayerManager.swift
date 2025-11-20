//
//  AudioPlayerManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Combine
import MediaPlayer

final class AudioPlayerManager: ObservableObject {
    @Published var audiobook: AudiobookModel?
    @Published var isPlaying: Bool = false
    @Published var currentTime: Double?
    @Published var duration: Double = 0
    @Published var playerState: PlayerState = .idle
    @Published var playbackSpeed: Double = 1.0
    @AppStorage("savedPlaybackSpeed") private var savedPlaybackSpeed: Double = 1.0
    @Published private var artworkImage: UIImage?
    private var artworkImageSignature: Data?

    private let player: PlayerWrapper
    private let audioURLManager: AudioURLManager
    private let remoteCommandHandler: RemoteCommandHandler

    private var cancellables = Set<AnyCancellable>()
    private var persistentCancellables = Set<AnyCancellable>()

    // Store backup URL for fallback on error
    private var backupAudioURL: URL?
    private var primaryAudioURL: URL?
    private var hasTriedBackupURL: Bool = false

    let nowPlayingHandler: NowPlayingHandler
    
    init(
        playbackManager: PlayerWrapper = PlayerWrapper(),
        nowPlayingHandler: NowPlayingHandler = NowPlayingHandler(),
        remoteCommandHandler: RemoteCommandHandler = RemoteCommandHandler(),
        resourceResolver: AudioURLManager = AudioURLManager()
    ) {
        self.player = playbackManager
        self.nowPlayingHandler = nowPlayingHandler
        self.remoteCommandHandler = remoteCommandHandler
        self.audioURLManager = resourceResolver

        // Initialize playback speed from storage
        self.playbackSpeed = savedPlaybackSpeed

        // Setup playback speed persistence
        setupPlaybackSpeedObserver()
        
        setupRemoteCommands()
    }
    
    private func bind() {
        player.isPlayingPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isPlaying in
                self?.isPlaying = isPlaying
            }
            .store(in: &cancellables)

        player.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self = self else { return }
                self.playerState = state

                // Handle player errors with backup URL fallback
                if case .failed(let error) = state {
                    // Try backup URL if available and not already tried
                    if let backupURL = self.backupAudioURL, !self.hasTriedBackupURL {
                        let failedURL = self.hasTriedBackupURL ? backupURL : self.primaryAudioURL
                        print("❌ [Player] URL failed: \(failedURL?.absoluteString ?? "unknown")")
                        print("🔄 [Player] Retrying with backup URL: \(backupURL.absoluteString)")
                        self.hasTriedBackupURL = true
                        Task { await self.retryWithBackupURL(backupURL) }
                    } else {
                        DispatchQueue.main.async {
                            Toastify.show(style: .error, message: "audio_loading_error".localized)
                            print("❌ [Player] Playback failed: \(error.localizedDescription)")
                        }
                    }
                }
            }
            .store(in: &cancellables)
        
        player.timePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] currentTime in
                guard let self = self else { return }
                self.currentTime = currentTime
                self.updateProgress()
                self.updateNowPlayingInfo()
            }
            .store(in: &cancellables)
        
        player.durationPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] duration in
                guard let self = self else { return }
                self.duration = duration
                self.updateNowPlayingInfo()
            }
            .store(in: &cancellables)
        
        player.playbackFinishedPublisher
            .first()
            .sink { [weak self] in
                Task { await self?.nextAudio() }
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Player Setup
    
    @MainActor
    func setupPlayer(with audiobook: AudiobookModel) async {
        cancellables.removeAll()
        self.currentTime = nil
        self.audiobook = audiobook

        // Reset URL state for new setup
        self.primaryAudioURL = nil
        self.backupAudioURL = nil
        self.hasTriedBackupURL = false

        let currentResourceIndex = audiobook.playbackInfo.currentResourceIndex
        let startTime = audiobook.readingOrder[currentResourceIndex].startTime
        let endTime = audiobook.readingOrder[currentResourceIndex].endTime
        let currentPosition = audiobook.playbackInfo.progressInCurrentResource
        let result = await audioURLManager.getURL(for: audiobook)

        switch result {
        case .success(let urlResult):
            // Store URLs for potential fallback and error logging
            self.primaryAudioURL = urlResult.primaryURL
            self.backupAudioURL = urlResult.backupURL

            // Bind BEFORE setup to catch errors during initial load
            updateNowPlayingMetadata()
            bind()

            player.setupWithURL(
                with: urlResult.primaryURL,
                startTime: startTime,
                endTime: endTime,
                playWhenReady: true,
                seek: currentPosition
            )

            // Apply stored playback speed
            player.setPlaybackSpeed(playbackSpeed)
        case .failure(let error):
            Toastify.show(style: .error, message: "audio_loading_error".localized)
            print("❌ [Player] Failed to get URL: \(error.localizedDescription)")
        }
    }
    
    private func updateNowPlayingMetadata() {
        guard let audiobook = audiobook else { return }
        
        let metadata = NowPlayingMetadata(
            title: audiobook.title,
            artist: audiobook.authors.joined(separator: ", "),
            album: audiobook.title,
            artworkImage: artworkImage
        )
        
        nowPlayingHandler.updateMetadata(metadata)
    }
    
    private func updateNowPlayingInfo() {
        nowPlayingHandler.updatePlaybackInfo(
            currentTime: currentTime ?? 0,
            duration: duration,
            rate: isPlaying ? Float(playbackSpeed) : 0.0
        )
    }
    
    private func setupPlaybackSpeedObserver() {
        $playbackSpeed
            .sink { [weak self] speed in
                self?.savedPlaybackSpeed = speed
            }
            .store(in: &persistentCancellables)
    }

    @MainActor
    private func retryWithBackupURL(_ backupURL: URL) async {
        guard let audiobook = audiobook else { return }

        let currentResourceIndex = audiobook.playbackInfo.currentResourceIndex
        let startTime = audiobook.readingOrder[currentResourceIndex].startTime
        let endTime = audiobook.readingOrder[currentResourceIndex].endTime
        let currentPosition = audiobook.playbackInfo.progressInCurrentResource

        player.setupWithURL(
            with: backupURL,
            startTime: startTime,
            endTime: endTime,
            playWhenReady: true,
            seek: currentPosition
        )

        // Apply stored playback speed
        player.setPlaybackSpeed(playbackSpeed)
    }
}

// MARK: - Playback Controls

extension AudioPlayerManager {
    func play() {
        player.play()
        player.setPlaybackSpeed(playbackSpeed)
        updateNowPlayingInfo()
    }
    
    func pause() {
        player.pause()
        updateNowPlayingInfo()
        // Save progress when paused
        audiobook?.updateBookProgressOnRemote()
    }
    
    func stop() {
        // Save progress before stopping
        audiobook?.updateBookProgressOnRemote()
        player.stop()
        nowPlayingHandler.clear()
        audiobook = nil
        artworkImage = nil
        artworkImageSignature = nil
        primaryAudioURL = nil
        backupAudioURL = nil
        hasTriedBackupURL = false
    }

    func stopAAX() {
        if let audiobook = audiobook, audiobook.isAAX {
            player.stop()
            nowPlayingHandler.clear()
            self.audiobook = nil
            artworkImage = nil
            artworkImageSignature = nil
            primaryAudioURL = nil
            backupAudioURL = nil
            hasTriedBackupURL = false
        }
    }
    
    func playPause() {
        isPlaying ? pause() : play()
    }
    
    func seek(to time: Double) {
        player.seek(to: time)
    }
    
    func seekBy(seconds: Double) {
        player.seekBy(seconds: seconds)
    }
    
    func seekForward() {
        player.seekForward()
    }
    
    func seekBackward() {
        player.seekBackward()
    }
    
    func nextAudio() async {
        guard let audiobook else { return }
        let nextIndex = audiobook.playbackInfo.currentResourceIndex + 1

        // Check bounds BEFORE updating the index
        guard nextIndex < audiobook.readingOrder.count else { return }

        // Check if next chapter is ready
        if let completedChapters = audiobook.graphProgress?.completedChapters,
           !completedChapters.contains(nextIndex) {
            pause()
            return
        }

        audiobook.updateCurrentResourceIndex(index: nextIndex)
        pause()
        audiobook.updateProgressInCurrentResouce(currentProgress: 0)
        await setupPlayer(with: audiobook)
    }

    func previousAudio() async {
        guard let audiobook else { return }
        let previousIndex = audiobook.playbackInfo.currentResourceIndex - 1
        
        // Check bounds BEFORE updating the index
        guard previousIndex >= 0 else { return }
        
        audiobook.updateCurrentResourceIndex(index: previousIndex)
        pause()
        audiobook.updateProgressInCurrentResouce(currentProgress: 0)
        await setupPlayer(with: audiobook)
    }
    
    func playAudioWithIndex(_ index: Int) {
        guard let audiobook else { return }
        
        // Add bounds check before updating the index
        guard index >= 0 && index < audiobook.readingOrder.count else {
            print("Invalid audio index: \(index), valid range: 0..<\(audiobook.readingOrder.count)")
            return
        }
        
        audiobook.updateCurrentResourceIndex(index: index)
        audiobook.updateProgressInCurrentResouce(currentProgress: 0)
        pause()
        Task { await setupPlayer(with: audiobook) }
    }
    
    func setPlaybackSpeed(_ speed: Double) {
        let clampedSpeed = max(0.5, min(2.0, speed))
        playbackSpeed = clampedSpeed
        player.setPlaybackSpeed(clampedSpeed)
        updateNowPlayingInfo()
    }

    func updateArtwork(_ image: UIImage) {
        let signature = image.pngData() ?? image.jpegData(compressionQuality: 1.0)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let signature, signature == self.artworkImageSignature { return }
            self.artworkImageSignature = signature
            self.artworkImage = image
            self.nowPlayingHandler.updateArtwork(image)
        }
    }
}

// MARK: - Helpers

extension AudioPlayerManager {
    private func getCurrentPosition() -> Double {
        guard let audiobook, let currentTime else { return 0.0 }

        let currentIndex = audiobook.playbackInfo.currentResourceIndex

        let totalOfPreviousChapters = audiobook.readingOrder
            .prefix(currentIndex)
            .reduce(0.0) { partial, chapter in
                partial + (chapter.endTime - chapter.startTime)
            }

        let totalProgress = totalOfPreviousChapters + currentTime
        return max(0.0, totalProgress)
    }

    private func updateProgress() {
        guard let currentTime else { return }

        audiobook?.updateProgress(
            currentProgress: currentTime,
            totralProgress: getCurrentPosition()
        )

        // Update remote progress every second while playing
        if isPlaying {
            audiobook?.updateBookProgressOnRemote()
        }
    }
}

// MARK: - Remote Command Setup

extension AudioPlayerManager: RemoteCommandDelegate {
    private func setupRemoteCommands() {
        remoteCommandHandler.setNextPreviousEnabled(true)
        remoteCommandHandler.setSeekEnabled(true)
        remoteCommandHandler.delegate = self
    }
    
    // MARK: - RemoteCommandDelegate
    
    func remoteCommandPlay() -> MPRemoteCommandHandlerStatus {
        play()
        return .success
    }
    
    func remoteCommandPause() -> MPRemoteCommandHandlerStatus {
        pause()
        return .success
    }
    
    func remoteCommandTogglePlayPause() -> MPRemoteCommandHandlerStatus {
        playPause()
        return .success
    }
    
    func remoteCommandNextTrack() -> MPRemoteCommandHandlerStatus {
        Task { await nextAudio() }
        return .success
    }
    
    func remoteCommandPreviousTrack() -> MPRemoteCommandHandlerStatus {
        Task { await previousAudio() }
        return .success
    }
    
    func remoteCommandSeekForward() -> MPRemoteCommandHandlerStatus {
        seekForward()
        return .success
    }
    
    func remoteCommandSeekBackward() -> MPRemoteCommandHandlerStatus {
        seekBackward()
        return .success
    }
    
    func remoteCommandChangePlaybackPosition(to position: TimeInterval) -> MPRemoteCommandHandlerStatus {
        seek(to: position)
        return .success
    }
}
