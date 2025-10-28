//
//  NewPlayerView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerView: View {
    private let coordinator: Coordinator
    @StateObject private var playerCoordinator: PlayerCoordinator
    @StateObject private var playerViewModel: PlayerViewModel
    @StateObject private var graphViewModel: GraphViewModel
    @State private var sceneStylesViewModel: SceneStylesViewModel
    @StateObject private var videoShareProgress = VideoShareProgress()
    
    init(
        coordinator: Coordinator,
        diContainer: DIContainer,
        audiobook: AudiobookModel
    ) {
        self.coordinator = coordinator
        
        _playerCoordinator = StateObject(wrappedValue: PlayerCoordinator())
        
        _playerViewModel = StateObject(
            wrappedValue: PlayerViewModel(
                player: diContainer.player,
                authService: diContainer.authService,
                audiobook: audiobook
            )
        )
        
        _graphViewModel = StateObject(
            wrappedValue: GraphViewModel(
                audiobook: audiobook,
                player: diContainer.player
            )
        )
        
        sceneStylesViewModel = SceneStylesViewModel(
            audiobook: audiobook,
            player: diContainer.player,
            diContainer: diContainer
        )
    }
    
    var body: some View {
        ZStack (alignment: .bottom) {
            SceneCarouselView(viewModel: sceneStylesViewModel)
                .onTapGesture {
                    HapticFeedback.shared.trigger(style: .heavy)
                    playerViewModel.playPause()
                }
            
            playPauseButton
            
            if playerCoordinator.showBlackOverlay {
                Color.black.opacity(0.82).ignoresSafeArea()
            }

            controls

            // Video share progress overlay
            if videoShareProgress.isShowing {
                VideoShareProgressView(progressState: videoShareProgress)
            }
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .sheet(isPresented: $playerCoordinator.presentTableOfContents) {
            TableOfContentsView(viewModel: playerViewModel)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(24)
        }
        .trackScreenView(
            "Player",
            properties: [
                "book_id": playerViewModel.audiobook.id,
                "book_title": playerViewModel.audiobook.title,
                "author": playerViewModel.audiobook.authors,
                "is_AAX": playerViewModel.audiobook.isAAX
            ]
        )
    }
    
    @ViewBuilder
    private var currentTabBarItemSelected: some View {
        switch playerCoordinator.selectedTab {
        case .bookInfo:
            PlayerBookInfo(
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel,
                sceneStylesViewModel: sceneStylesViewModel
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .styleList:
            StylePicker(
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel,
                sceneStylesViewModel: sceneStylesViewModel
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .generateNewStyle:
            GenerateStyleView(
                coordinator: coordinator,
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel,
                sceneStylesViewModel: sceneStylesViewModel
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .shareVideo:
            PlayerVideoShareView(
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel,
                sceneStylesViewModel: sceneStylesViewModel,
                videoShareProgress: videoShareProgress
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .timeSlider:
            PlaybackSlider(
                playerCoordinator: playerCoordinator,
                viewModel: playerViewModel
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .sceneList:
            SceneListView(
                playerCoordinator: playerCoordinator,
                graphViewModel: graphViewModel,
                sceneStylesViewModel: sceneStylesViewModel
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
    
    private var controls: some View {
        VStack(spacing: 0) {
            PlayerNavigationBar(
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel,
                sceneStylesViewModel: sceneStylesViewModel
            )
            
            currentTabBarItemSelected
            
            SceneProgressBar(progress: sceneStylesViewModel.currentSceneProgress)
            
            PlayerTabBar(
                coordinator: coordinator,
                playerCoordinator: playerCoordinator,
                playerViewModel: playerViewModel
            )
        }
    }
    
    private var playPauseButton: some View {
        VStack {
            Spacer()
            
            VStack {
                Image(systemName: playerViewModel.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 68))
                    .foregroundColor(.white)
                    .opacity(playerViewModel.playerState == .playing ? 0 : 1)
                    .animation(
                        playerViewModel.playerState == .playing ?
                        Animation.easeInOut(duration: 1) : .none,
                        value: playerViewModel.playerState
                    )
            }
            .background(.white.opacity(0.00001))
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .heavy)
                playerViewModel.playPause()
            }
            .trackButtonTap("Play Pause Overlay")
            
            Spacer()
        }
    }
}
