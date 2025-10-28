//
//  PlayerTabBar.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerTabBar: View {
    private let coordinator: Coordinator
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    
    init(
        coordinator: Coordinator,
        playerCoordinator: PlayerCoordinator,
        playerViewModel: PlayerViewModel
    ) {
        self.coordinator = coordinator
        self.playerCoordinator = playerCoordinator
        self.playerViewModel = playerViewModel
    }
    
    var body: some View {
        HStack(alignment: .center) {
            makeTabButton(
                isSelected: playerCoordinator.selectedTab == .bookInfo,
                image: PlayerTabBarItem.bookInfo.icon,
                size: 24,
                action: {
                    coordinator.dismissModal()
                }
            )
            .trackButtonTap("Minimize Player")
            
            makeTabButton(
                isSelected: playerCoordinator.selectedTab == .bookInfo,
                image: playerViewModel.isPlaying ? "pause.fill" : "play.fill",
                size: 28,
                action: {
                    playerViewModel.playPause()
                }
            )
            .trackButtonTap("Play pause")
            
            MainActionButton() {
                performWithGraphCheck {
                    if playerCoordinator.selectedTab == .sceneList {
                        playerCoordinator.selectTab(.bookInfo)
                    } else {
                        playerCoordinator.selectTab(.sceneList)
                    }
                }
            }
            .trackButtonTap("Scene List")
            
            makeTabButton(
                isSelected: playerCoordinator.selectedTab == .styleList || playerCoordinator.selectedTab == .bookInfo,
                image: PlayerTabBarItem.styleList.icon,
                size: 24,
                action: {
                    performWithGraphCheck {
                        if playerCoordinator.selectedTab == .styleList {
                            playerCoordinator.selectTab(.bookInfo)
                        } else {
                            playerCoordinator.selectTab(.styleList)
                        }
                    }
                }
            )
            .trackButtonTap("Style List")
            
            makeTabButton(
                isSelected: playerCoordinator.selectedTab == .shareVideo || playerCoordinator.selectedTab == .bookInfo,
                image: PlayerTabBarItem.shareVideo.icon,
                size: 28,
                action: {
                    performWithGraphCheck {
                        if playerCoordinator.selectedTab == .shareVideo {
                            playerCoordinator.selectTab(.bookInfo)
                        } else {
                            playerCoordinator.selectTab(.shareVideo)
                        }
                    }
                }
            )
            .trackButtonTap("Share Video")
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .frame(maxWidth: .infinity)
        .frame(height: 62)
        .background(.black)
    }
    
    // Helper method to avoid repetition for graph availability check
    private func performWithGraphCheck(action: () -> Void) {
//        if !stylesViewModel.graphAvailable {
//            Toastify.show(style: .error, message: "There is no graph available for this audiobook, try again later.")
//            return
//        }
        
        action()
    }
    
    private func makeTabButton(
        isSelected: Bool,
        image: String,
        size: CGFloat,
        action: @escaping () -> Void
    ) -> some View {
        Image(systemName: image)
            .font(.system(size: size, weight: .light))
            .foregroundColor(isSelected ? .white : .gray)
            .frame(maxWidth: .infinity)
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .medium)
                
                action()
            }
    }
}
