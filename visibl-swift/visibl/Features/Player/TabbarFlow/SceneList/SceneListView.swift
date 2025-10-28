//
//  SceneListView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SceneListView: View {
    @State private var viewModel: SceneListViewModel
    @Bindable private var sceneStylesViewModel: SceneStylesViewModel
    private let containerWidth = UIScreen.main.bounds.width
    
    init(
        playerCoordinator: PlayerCoordinator,
        graphViewModel: GraphViewModel,
        sceneStylesViewModel: SceneStylesViewModel
    ) {
        self.sceneStylesViewModel = sceneStylesViewModel
        _viewModel = State(wrappedValue: SceneListViewModel(
            playerCoordinator: playerCoordinator,
            graphViewModel: graphViewModel,
            sceneStylesViewModel: sceneStylesViewModel
        ))
    }
    
    var body: some View {
        ScrollViewReader { hScrollProxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    sceneListContent(hScrollProxy: hScrollProxy)
                        .frame(width: containerWidth)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                        .id(0)
                    
                    detailsView(hScrollProxy: hScrollProxy)
                        .frame(width: containerWidth)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                        .id(1)
                }
                .scrollTargetLayout()
            }
            .scrollDisabled(viewModel.selectedScene == nil)
            .scrollTargetBehavior(.viewAligned)
            .onAppear {
                // Ensure we start at the scene list view
                DispatchQueue.main.async {
                    hScrollProxy.scrollTo(0, anchor: .leading)
                }
            }
        }
        .onAppear {
            viewModel.loadInitialData()
        }
        .onChange(of: sceneStylesViewModel.currentStyleId) { _, _ in
            viewModel.handleStyleChange()
        }
        .onChange(of: sceneStylesViewModel.chapters) { _, _ in
            viewModel.handleChaptersChange()
        }
        .onChange(of: sceneStylesViewModel.currentSceneIndex) { _, newValue in
            viewModel.handleCurrentSceneChange(newValue)
        }
        .trackScreenView(
            "Scene List",
            properties: [
                "book_id": viewModel.audiobook.id,
                "book_title": viewModel.audiobook.title,
                "author": viewModel.audiobook.authors,
                "is_AAX": viewModel.audiobook.isAAX
            ]
        )
    }
    
    // MARK: - Scene List Content
    
    @ViewBuilder
    private func sceneListContent(hScrollProxy: ScrollViewProxy) -> some View {
        SceneListContent(
            scenes: viewModel.scenes,
            selectedSceneIndex: $viewModel.selectedSceneIndex,
            currentSceneIndex: viewModel.currentSceneIndex,
            sceneSelected: { state, scene in
                viewModel.selectScene(scene, at: viewModel.selectedSceneIndex)
                withAnimation {
                    hScrollProxy.scrollTo(1, anchor: .center)
                    viewModel.state = state
                }
            },
            locationSelected: { state, location in
                if let location = location {
                    viewModel.selectLocation(location)
                    withAnimation {
                        hScrollProxy.scrollTo(1, anchor: .center)
                        viewModel.state = state
                    }
                }
            },
            characterSelected: { state, character in
                if let character = character {
                    viewModel.selectCharacter(character)
                    withAnimation {
                        hScrollProxy.scrollTo(1, anchor: .center)
                        viewModel.state = state
                    }
                }
            },
            hideAction: {
                viewModel.hideSceneList()
            }
        )
    }
    
    // MARK: - Details View
    
    @ViewBuilder
    private func detailsView(hScrollProxy: ScrollViewProxy) -> some View {
        switch viewModel.state {
        case .promptDetails:
            ScenePromptView(
                scene: viewModel.selectedScene,
                resetState: {
                    resetToList(hScrollProxy: hScrollProxy)
                }
            )
        case .locationDetails:
            LocationDetailsView(
                location: viewModel.selectedLocation,
                resetState: {
                    resetToList(hScrollProxy: hScrollProxy)
                }
            )
        case .characterDetails:
            CharacterDetailsView(
                character: viewModel.selectedCharacter,
                resetState: {
                    resetToList(hScrollProxy: hScrollProxy)
                }
            )
        }
    }
    
    // MARK: - Helper Methods
    
    private func resetToList(hScrollProxy: ScrollViewProxy) {
        withAnimation {
            hScrollProxy.scrollTo(0, anchor: .center)
            viewModel.resetState()
        }
    }
}
