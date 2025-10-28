//
//  NowPlayingHandler.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import MediaPlayer
import UIKit

public final class NowPlayingHandler {
    // MARK: - Properties
    
    private var metadata: NowPlayingMetadata?
    private var playbackInfo: PlaybackInfo = PlaybackInfo()
    private let updateQueue = DispatchQueue(label: "avplayerkit.nowplaying", qos: .userInitiated)
    
    // Throttled update function
    private lazy var throttledUpdate = throttle(duration: 1.0) { [weak self] in
        self?.performUpdate()
    }
    
    // MARK: - Public Methods
    
    /// Updates the media metadata (title, artist, album, artwork)
    public func updateMetadata(_ metadata: NowPlayingMetadata) {
        updateQueue.async { [weak self] in
            self?.metadata = metadata
            self?.throttledUpdate()
        }
    }
    
    /// Updates only the artwork
    public func updateArtwork(_ artwork: UIImage) {
        let mpMediaItemArtwork = MPMediaItemArtwork(boundsSize: artwork.size) { _ in artwork }
        updateQueue.async { [weak self] in
            guard let currentMetadata = self?.metadata else { return }
            self?.metadata = NowPlayingMetadata(
                title: currentMetadata.title,
                artist: currentMetadata.artist,
                album: currentMetadata.album,
                artwork: mpMediaItemArtwork,
                fullScreenArtworkImage: artwork,
                fullScreenArtworkIdentifier: UUID().uuidString
            )
            self?.throttledUpdate()
        }
    }
    
    /// Updates playback information (time, duration, rate)
    public func updatePlaybackInfo(
        currentTime: TimeInterval,
        duration: TimeInterval,
        rate: Float = 1.0
    ) {
        updateQueue.async { [weak self] in
            self?.playbackInfo = PlaybackInfo(
                currentTime: currentTime,
                duration: duration,
                rate: rate
            )
            self?.throttledUpdate()
        }
    }
    
    /// Updates only the playback rate
    public func updatePlaybackRate(_ rate: Float) {
        updateQueue.async { [weak self] in
            self?.playbackInfo.rate = rate
            self?.throttledUpdate()
        }
    }
    
    /// Clears all now playing information
    public func clear() {
        updateQueue.async { [weak self] in
            self?.metadata = nil
            self?.playbackInfo = PlaybackInfo()
            DispatchQueue.main.async {
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func performUpdate() {
        var info: [String: Any] = [:]
        
        // Add metadata if available
        if let metadata = metadata {
            info[MPMediaItemPropertyTitle] = metadata.title
            info[MPMediaItemPropertyArtist] = metadata.artist
            info[MPMediaItemPropertyAlbumTitle] = metadata.album
            info[MPMediaItemPropertyArtwork] = metadata.artwork

            if #available(iOS 26.0, *),
               let fullScreenArtwork = makeStaticFullScreenArtwork(from: metadata) {
                info[MPNowPlayingInfoProperty3x4AnimatedArtwork] = fullScreenArtwork
            }
        }
        
        // Add playback info
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = playbackInfo.currentTime
        info[MPMediaItemPropertyPlaybackDuration] = playbackInfo.duration
        info[MPNowPlayingInfoPropertyPlaybackRate] = playbackInfo.rate
        
        // Update on main queue
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }
    
    private func throttle(
        duration: TimeInterval,
        action: @escaping () -> Void
    ) -> () -> Void {
        var lastRun = Date.distantPast
        let queue = DispatchQueue.main
        
        return {
            let now = Date()
            let deadline = lastRun.addingTimeInterval(duration)
            
            if now >= deadline {
                lastRun = now
                action()
            } else {
                queue.asyncAfter(deadline: .now() + deadline.timeIntervalSince(now)) {
                    let now = Date()
                    if now >= lastRun.addingTimeInterval(duration) {
                        lastRun = now
                        action()
                    }
                }
            }
        }
    }
    
    // MARK: - Supporting Types
    
    private struct PlaybackInfo {
        var currentTime: TimeInterval = 0
        var duration: TimeInterval = 0
        var rate: Float = 0
    }
}

// MARK: - Helpers

@available(iOS 26.0, *)
private extension NowPlayingHandler {
    func makeStaticFullScreenArtwork(from metadata: NowPlayingMetadata) -> MPMediaItemAnimatedArtwork? {
        guard let image = metadata.fullScreenArtworkImage else { return nil }

        return MPMediaItemAnimatedArtwork(
            artworkID: metadata.fullScreenArtworkIdentifier,
            previewImageRequestHandler: { size, completion in
                let renderedImage = render(image, toFill: size) ?? image
                completion(renderedImage)
            },
            videoAssetFileURLRequestHandler: { _, completion in
                completion(nil)
            }
        )
    }
}

private func render(_ image: UIImage, toFill targetSize: CGSize) -> UIImage? {
    guard targetSize.width > 0, targetSize.height > 0 else { return image }

    let format = UIGraphicsImageRendererFormat()
    format.scale = image.scale

    let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
    return renderer.image { _ in
        let widthRatio = targetSize.width / image.size.width
        let heightRatio = targetSize.height / image.size.height
        let scale = max(widthRatio, heightRatio)
        let scaledSize = CGSize(
            width: image.size.width * scale,
            height: image.size.height * scale
        )
        let origin = CGPoint(
            x: (targetSize.width - scaledSize.width) / 2.0,
            y: (targetSize.height - scaledSize.height) / 2.0
        )
        image.draw(in: CGRect(origin: origin, size: scaledSize))
    }
}
