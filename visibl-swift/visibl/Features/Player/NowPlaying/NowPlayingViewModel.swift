//
//  NowPlayingViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import Kingfisher

final class NowPlayingViewModel: ObservableObject {
    private let player: AudioPlayerManager
    private let userConfig = UserConfigurations.shared
    private var subscriptions = Set<AnyCancellable>()

    @Published var isPlaying: Bool = false
    @Published var currentTime: Double?
    @Published var audiobook: AudiobookModel?

    init(player: AudioPlayerManager) {
        self.player = player
        bind()
    }
}

extension NowPlayingViewModel {
    private func bind() {
        player.$audiobook
            .receive(on: DispatchQueue.main)
            .sink { [weak self] audiobook in
                self?.audiobook = audiobook
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
                self?.currentTime = currentTime
            }
            .store(in: &subscriptions)
    }
}

extension NowPlayingViewModel {
    func play() {
        player.play()
    }
    
    func pause() {
        player.pause()
    }
    
    func playPause() {
        isPlaying ? pause() : play()
    }
    
    func seekBackward() {
        player.seekBackward()
    }
    
    func stopPlayer() {
        player.stop()
        player.currentTime = nil
    }
}

// MARK: - Helper Computed Properties

extension NowPlayingViewModel {
    /// Effective style ID for scene images
    var effectiveStyleId: String? {
        guard let audiobook = audiobook else { return nil }

        if let currentStyle = audiobook.sceneStyleInfo.currentSceneStyle,
           !currentStyle.isEmpty {
            return currentStyle
        }

        return audiobook.publication.defaultSceneId
    }
}

// MARK: - Lock Screen Artwork

extension NowPlayingViewModel {
    /// Update lock screen artwork from the given image URL
    func updateLockScreenArtwork(from imageURL: URL) {
        if userConfig.displayCarouselOnHomeScreen {
            Task {
                let image = await ImageDownloadManager.shared.getImage(from: imageURL.absoluteString)
                if let image = image {
                    player.updateArtwork(image)
                }
            }
        } else {
            Task {
                await updateArtworkWithCover()
            }
        }
    }

    private func updateArtworkWithCover() async {
        guard let audiobook = audiobook, let url = URL(string: audiobook.coverURL) else { return }

        do {
            let result = try await KingfisherManager.shared.retrieveImage(with: url)
            player.updateArtwork(result.image)
        } catch {
            print(error.localizedDescription)
        }
    }
}
