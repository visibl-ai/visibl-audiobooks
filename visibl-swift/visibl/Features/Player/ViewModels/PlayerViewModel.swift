//
//  PlayerViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine

final class PlayerViewModel: ObservableObject {
    @Published var audiobook: AudiobookModel
    @Published var playerState: PlayerState = .idle
    @Published var isPlaying: Bool = false
    
    @Published var currentTime: Double?
    
    @Published var duration: Double = 0
    @Published var sliderValue: Double = 0
    @Published var isEditing: Bool = false
    @Published var playbackSpeed: Double = 1.0

    // MARK: - Dependencies

    private let player: AudioPlayerManager
    private var subscriptions = Set<AnyCancellable>()
    private let databaseManager = RTDBManager.shared
    let authService: AuthServiceProtocol

    var timeLeft: String {
        let seconds = Int(duration - (currentTime ?? 0))
        let minutes = seconds / 60
        let secondsPart = seconds % 60
        return String(format: "%02d:%02d", minutes, secondsPart)
    }
    
    init(
        player: AudioPlayerManager,
        authService: AuthServiceProtocol,
        audiobook: AudiobookModel
    ) {
        self.player = player
        self.authService = authService
        self.audiobook = audiobook
        if player.audiobook != audiobook { Task { await player.setupPlayer(with: audiobook) } }
        bind()
        setupGraphProgressObserver()
    }

    private func setupGraphProgressObserver() {
        NotificationCenter.default.addObserver(
            forName: .graphProgressDidUpdate,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let updatedPublication = notification.object as? PublicationModel,
                  updatedPublication.id == self.audiobook.publication.id else {
                return
            }
            self.audiobook.publication = updatedPublication
            self.objectWillChange.send()
        }
    }
}

// MARK: - Player Binding

extension PlayerViewModel {
    private func bind() {
        player.$playerState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] playerState in
                self?.playerState = playerState
            }
            .store(in: &subscriptions)
        
        player.$isPlaying
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isPlaying in
                self?.isPlaying = isPlaying
            }
            .store(in: &subscriptions)
        
        player.$currentTime
            .receive(on: DispatchQueue.main)
            .sink { [weak self] currentTime in
                guard let self = self else { return }
                self.currentTime = currentTime
            }
            .store(in: &subscriptions)
        
        player.$duration
            .receive(on: DispatchQueue.main)
            .sink { [weak self] duration in
                self?.duration = duration
            }
            .store(in: &subscriptions)
        
        player.$playbackSpeed
            .receive(on: DispatchQueue.main)
            .sink { [weak self] playbackSpeed in
                self?.playbackSpeed = playbackSpeed
            }
            .store(in: &subscriptions)
    }
}

// MARK: - Player Controls

extension PlayerViewModel {
    func play() {
        player.play()
    }
    
    func pause() {
        player.pause()
    }
    
    func stop() {
        player.stop()
    }
    
    func playPause() {
        isPlaying ? pause() : play()
    }
    
    func seek(to time: Double) {
        player.seek(to: time)
    }
    
    func seekForward() {
        player.seekForward()
    }
    
    func seekBackward() {
        player.seekBackward()
    }
    
    func setPlaybackSpeed(_ speed: Double) {
        player.setPlaybackSpeed(speed)
    }
    
    func nextAudio() {
        Task { await player.nextAudio() }
    }
    
    func previousAudio() {
        Task { await player.previousAudio() }
    }
    
    func playAudio(at index: Int) {
        player.playAudioWithIndex(index)
    }
}

