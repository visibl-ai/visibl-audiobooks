//
//  PlayerBookInfo.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerBookInfo: View {
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    
    @ObservedObject private var transcriptionManager = TranscriptionManager.shared
    
    @Bindable var sceneStylesViewModel: SceneStylesViewModel
    
    private var transcriptionTask: TaskGroupModelSTT? {
        transcriptionManager.taskGroups.first { $0.id == playerViewModel.audiobook.id }
    }
    
    private var isLoading: Bool {
        let state = playerViewModel.playerState
        return state == .loading || state == .buffering || state == .idle
    }

    private var isNextChapterProcessing: Bool {
        guard let graphProgress = playerViewModel.audiobook.graphProgress else {
            return false
        }

        let playbackInfo = playerViewModel.audiobook.playbackInfo
        let currentIndex = playbackInfo.currentResourceIndex
        let progressInChapterSeconds = playbackInfo.progressInCurrentResource
        let nextIndex = currentIndex + 1

        guard nextIndex < playerViewModel.audiobook.readingOrder.count else {
            return false
        }

        let currentChapter = playerViewModel.audiobook.readingOrder[currentIndex]
        let timeUntilEnd = currentChapter.duration - progressInChapterSeconds
        let isNearEnd = timeUntilEnd <= 5

        let isNextProcessing = graphProgress.processingChapters?.contains(nextIndex) ?? false

        // print("🎯 Chapter \(currentIndex), progress: \(progressInChapterSeconds)s, duration: \(currentChapter.duration)s")
        // print("🎯 timeUntilEnd: \(timeUntilEnd)s, isNearEnd: \(isNearEnd), nextProcessing: \(isNextProcessing)")

        return isNearEnd && isNextProcessing
    }

    var body: some View {
        VStack (spacing: 0) {
            if isNextChapterProcessing {
                ToastifyView(
                    style: .info,
                    text: "player_chapter_in_not_ready_message".localized,
                    action: {}
                )
                .padding(.top, 16)
                .padding(.horizontal, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                VStack (spacing: 2) {
                    Text(playerViewModel.audiobook.authors.joined(separator: ", "))
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    Text(playerViewModel.audiobook.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                
                HStack (spacing: 12) {
                    PlayerStyleNameView(
                        isLoading: isLoading,
                        styleName: sceneStylesViewModel.currentStyleTitle
                    ) {
                        print("Current style id: \(sceneStylesViewModel.currentStyleId ?? "none")")
                    }

                    if !isLoading {
                        transcriptionMinimizedView
                    }
                    
                    if sceneStylesViewModel.isCurrentSceneLoading {
                        ProgressView()
                            .scaleEffect(1)
                            .tint(.white)
                    }
                }
            }
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
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isNextChapterProcessing)
    }
    
    @ViewBuilder private var transcriptionMinimizedView: some View {
        if let _ = transcriptionTask {
            HStack(spacing: 4) {
                Image(systemName: "waveform.path")
                    .font(.system(size: 12))
                    .foregroundStyle(.white)
                HStack(spacing: 6) {
                    Text(playerViewModel.audiobook.progressString)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                    
                    Text(transcriptionManager.progressString(for: playerViewModel.audiobook.id))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 6))
        }
    }
}
