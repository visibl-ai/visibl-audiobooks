//
//  PlaybackSlider.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlaybackSlider: View {
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var viewModel: PlayerViewModel
    
    private let analytics: AnalyticsManager = .shared
    
    var body: some View {
        VStack (spacing: 0) {
            Color.white.opacity(0.001)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onTapGesture {
                    HapticFeedback.shared.trigger(style: .medium)
                    
                    withAnimation {
                        playerCoordinator.selectedTab = .bookInfo
                    }
                }
            
            PlayerTimeSlider(
                author: viewModel.audiobook.authors.joined(separator: ", "),
                bookName: viewModel.audiobook.title,
                time: Binding(
                    get: {
                        viewModel.currentTime ?? 0
                    },
                    set: {
                        viewModel.seek(to: $0)
                    }
                ),
                duration: viewModel.duration,
                isNextEnabled: canGoToNextTrack,
                isPreviousEnabled: canGoToPreviousTrack,
                playbackSpeed: Binding(
                    get: {
                        viewModel.playbackSpeed
                    },
                    set: { _ in }
                ),
                onSpeedChange: { speed in
                    viewModel.setPlaybackSpeed(speed)
                },
                nextAction: {
                    guard canGoToNextTrack else { return }
                    
                    withAnimation {
                        playerCoordinator.selectedTab = .bookInfo
                    }
                    
                    viewModel.nextAudio()
                    
                    analytics.captureEvent(
                        "Next Chapter",
                        properties: [
                            "book_id": viewModel.audiobook.id,
                            "book_title": viewModel.audiobook.title,
                            "author": viewModel.audiobook.authors,
                            "is_AAX": viewModel.audiobook.isAAX
                        ]
                    )
                },
                previousAction: {
                    guard canGoToPreviousTrack else { return }
                    
                    withAnimation {
                        playerCoordinator.selectedTab = .bookInfo
                    }
                    
                    viewModel.previousAudio()
                    
                    analytics.captureEvent(
                        "Previous Chapter",
                        properties: [
                            "book_id": viewModel.audiobook.id,
                            "book_title": viewModel.audiobook.title,
                            "author": viewModel.audiobook.authors,
                            "is_AAX": viewModel.audiobook.isAAX
                        ]
                    )
                }
            )
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .black.opacity(0.75)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .trackScreenView(
            "Playback Slider",
            properties: [
                "book_id": viewModel.audiobook.id,
                "book_title": viewModel.audiobook.title,
                "author": viewModel.audiobook.authors,
                "is_AAX": viewModel.audiobook.isAAX
            ]
        )
    }
    
    // MARK: - Helper Properties
    
    private var canGoToNextTrack: Bool {
        let currentIndex = viewModel.audiobook.playbackInfo.currentResourceIndex
        let nextIndex = currentIndex + 1
        
        // Check if next chapter exists
        guard nextIndex < viewModel.audiobook.readingOrder.count else { return false }
        
        // For AAX books, check if next chapter is ready
        if viewModel.audiobook.isAAX {
            return isChapterReady(index: nextIndex)
        }
        
        return true
    }
    
    private var canGoToPreviousTrack: Bool {
        let currentIndex = viewModel.audiobook.playbackInfo.currentResourceIndex
        let previousIndex = currentIndex - 1
        
        // Check if previous chapter exists
        guard previousIndex >= 0 else { return false }
        
        // For AAX books, check if previous chapter is ready
        if viewModel.audiobook.isAAX {
            return isChapterReady(index: previousIndex)
        }
        
        return true
    }
    
    private func isChapterReady(index: Int) -> Bool {
        guard let completedChapters = viewModel.audiobook.graphProgress?.completedChapters else {
            return true
        }
        return completedChapters.contains(index)
    }
}
