//
//  NowPlayingMetadata.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import MediaPlayer
import UIKit

public struct NowPlayingMetadata {
    public let title: String
    public let artist: String?
    public let album: String?
    public let artwork: MPMediaItemArtwork?
    public let fullScreenArtworkImage: UIImage?
    public let fullScreenArtworkIdentifier: String
    
    public init(
        title: String,
        artist: String? = nil,
        album: String? = nil,
        artwork: MPMediaItemArtwork? = nil,
        fullScreenArtworkImage: UIImage? = nil,
        fullScreenArtworkIdentifier: String? = nil
    ) {
        self.title = title
        self.artist = artist
        self.album = album
        self.artwork = artwork
        self.fullScreenArtworkImage = fullScreenArtworkImage
        self.fullScreenArtworkIdentifier = fullScreenArtworkIdentifier ?? UUID().uuidString
    }
    
    // Convenience initializer for UIImage
    public init(
        title: String,
        artist: String? = nil,
        album: String? = nil,
        artworkImage: UIImage? = nil,
        fullScreenArtworkImage: UIImage? = nil,
        fullScreenArtworkIdentifier: String? = nil
    ) {
        let mediaArtwork: MPMediaItemArtwork?
        if let image = artworkImage {
            mediaArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        } else {
            mediaArtwork = nil
        }

        self.init(
            title: title,
            artist: artist,
            album: album,
            artwork: mediaArtwork,
            fullScreenArtworkImage: fullScreenArtworkImage ?? artworkImage,
            fullScreenArtworkIdentifier: fullScreenArtworkIdentifier
        )
    }
}
