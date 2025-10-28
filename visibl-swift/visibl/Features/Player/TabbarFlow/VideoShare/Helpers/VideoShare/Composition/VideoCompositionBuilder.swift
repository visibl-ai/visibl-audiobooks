//
//  VideoCompositionBuilder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation

final class VideoCompositionBuilder {
    /// Creates an empty video composition
    static func createComposition(size: CGSize) throws -> (
        composition: AVMutableComposition,
        videoComposition: AVMutableVideoComposition,
        videoTrack: AVMutableCompositionTrack,
        audioTrack: AVMutableCompositionTrack
    ) {
        let composition = AVMutableComposition()
        let videoComposition = AVMutableVideoComposition()

        guard let videoTrack = composition.addMutableTrack(
                withMediaType: .video,
                preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(
                withMediaType: .audio,
                preferredTrackID: kCMPersistentTrackID_Invalid)
        else {
            throw VideoError.failedToCreateTracks
        }

        videoComposition.frameDuration = CMTimeMake(value: 1, timescale: 30)
        videoComposition.renderSize = size

        return (composition, videoComposition, videoTrack, audioTrack)
    }

    /// Adds audio to the composition
    static func addAudio(
        to audioTrack: AVMutableCompositionTrack,
        from audioUrl: URL,
        composition: AVMutableComposition
    ) async throws {
        print("Adding audio track from trimmed audio: \(audioUrl.path)")
        let audioAsset = AVURLAsset(url: audioUrl)
        if let sourceAudioTrack = try? await audioAsset.loadTracks(withMediaType: .audio).first {
            let audioTimeRange = CMTimeRange(
                start: .zero,
                duration: composition.duration
            )
            try audioTrack.insertTimeRange(audioTimeRange, of: sourceAudioTrack, at: .zero)
        } else {
            print("Warning: No audio track found in trimmed audio.")
        }
    }
}
