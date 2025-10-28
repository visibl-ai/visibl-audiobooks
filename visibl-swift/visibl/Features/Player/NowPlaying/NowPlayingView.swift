//
//  NowPlayingView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct NowPlayingView: View {
    @StateObject private var viewModel: NowPlayingViewModel
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    
    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        
        _viewModel = StateObject(
            wrappedValue: NowPlayingViewModel(
                player: diContainer.player
            )
        )
    }
    
    var body: some View {
        if viewModel.audiobook != nil {
            nowPlayingContent
        }
    }
    
    private var nowPlayingContent: some View {
        HStack(spacing: 12) {
            cover()
            audiobookInfo
            playbackButtons
        }
        .padding(12)
        .background {
            if #available(iOS 26.0, *) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.clear)
                    .glassEffect(in: .rect(cornerRadius: 16))
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.regularMaterial)
                    .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
            }
        }
        .padding(EdgeInsets(top: 0, leading: 16, bottom: 12, trailing: 16))
        .onTapGesture {
            if let audiobook = viewModel.audiobook {
                HapticFeedback.shared.trigger(style: .light)
                coordinator.presentFullScreenCover(.player(coordinator, audiobook))
            }
        }
        .trackButtonTap("Now Playing View")
    }
    
    private var audiobookInfo: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let audiobook = viewModel.audiobook {
                Text(audiobook.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                Text(audiobook.authors.joined(separator: ", "))
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    
    private var playbackButtons: some View {
        HStack(spacing: 12) {
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.seekBackward()
            }) {
                Image(systemName: "15.arrow.trianglehead.counterclockwise")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(.primary)
            }
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.playPause()
            }) {
                Image(systemName: viewModel.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundColor(.primary)
                    .frame(width: 32, height: 32)
            }
            
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                viewModel.stopPlayer()
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.primary)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 2)
                    .background(.white.opacity(0.0001))
            }
        }
    }
    
    @ViewBuilder
    private func cover() -> some View {
        if let imageURL = viewModel.imageURL {
            KFImage(imageURL)
                .placeholder { placeholder }
                .resizable()
                .fade(duration: 0.8)
                .forceTransition()
                .scaledToFill()
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 10))
        } else {
            placeholder
        }
    }
    
    private var placeholder: some View {
        Rectangle()
            .fill(Color(UIColor.systemGray4))
            .frame(maxWidth: .infinity)
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .shimmerEffect()
    }
}
