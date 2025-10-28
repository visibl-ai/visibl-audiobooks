//
//  PlayerNavigationBar.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Shimmer

struct PlayerNavigationBar: View {
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    @Bindable var sceneStylesViewModel: SceneStylesViewModel
    
    private var isLoading: Bool {
        let state = playerViewModel.playerState
        return state == .loading || state == .buffering || state == .idle
    }
    
    private var navBarTitle: String {
        playerViewModel.audiobook.currentChapterTitle
    }
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            PlayerNavbarButton(
                isLoading: isLoading,
                text: playerViewModel.timeLeft,
                alignment: .leading
            )
            .trackButtonTap("Scene List Navbar")
            
            PlayerNavbarTitle(text: navBarTitle) {
                playerCoordinator.presentTableOfContents = true
            }
            .trackButtonTap("TOC Navbar")
            
            PlayerSliderButton(isLoading: isLoading) {
                if playerCoordinator.selectedTab == .timeSlider {
                    playerCoordinator.selectTab(.bookInfo)
                } else {
                    playerCoordinator.selectTab(.timeSlider)
                }
            }
        }
        .padding(.horizontal, 20)
    }
}

struct NavigationBarCustomMenu: View {
    enum MenuState {
        case open, closed
        
        mutating func toggle() {
            switch self {
            case .open:
                self = .closed
            case .closed:
                self = .open
            }
        }
    }
    
    enum MenuItems: Identifiable, CaseIterable {
        case playback, speed, timer
        
        var id: Self { self }
        
        var title: String {
            switch self {
            case .playback:
                return "Player"
            case .speed:
                return "Speed"
            case .timer:
                return "Timer"
            }
        }
        
        var icon: String {
            switch self {
            case .playback:
                return "slider.horizontal.below.square.filled.and.square"
            case .speed:
                return "gauge.open.with.lines.needle.33percent"
            case .timer:
                return "timer"
            }
        }
    }
    
    @State var state: MenuState = .closed
    
    var body: some View {
        menuView
            // .background(.red)
            .onTapGesture {
                state.toggle()
            }
    }
    
    @ViewBuilder private var menuView: some View {
        switch state {
        case .open:
            menuOpenStateView
        case .closed:
            menuClosedStateView
        }
    }
    
    private var menuClosedStateView: some View {
        Image(systemName: "slider.horizontal.3")
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 8))
            .frame(width: 42, alignment: .trailing)
    }
    
    private var menuOpenStateView: some View {
        VStack(alignment: .trailing, spacing: 20) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(.ultraThinMaterial, in: .rect(cornerRadius: 8))
                .frame(width: 42, alignment: .trailing)
            
            VStack(alignment: .trailing, spacing: 12) {
                ForEach(MenuItems.allCases) { item in
                    makeButton(icon: item.icon, title: item.title)
                }
            }
        }
    }
    
    private func makeButton(icon: String, title: String) -> some View {
        VStack(spacing: 2) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white)
            
            Text(title)
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(width: 42, height: 42)
        .background(.ultraThinMaterial, in: .rect(cornerRadius: 9))
    }
}
