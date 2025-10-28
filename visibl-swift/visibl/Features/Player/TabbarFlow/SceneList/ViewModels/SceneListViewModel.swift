//
//  SceneListViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import SwiftUI

@MainActor
@Observable
final class SceneListViewModel {
    
    // MARK: - Observable Properties
    
    var scenes: [SceneModel] = []
    var selectedSceneIndex: Int = 0
    var selectedScene: SceneModel?
    var selectedLocation: LocationModel?
    var selectedCharacter: CharacterModel?
    var state: SceneListState = .promptDetails
    
    // MARK: - Dependencies
    
    private let playerCoordinator: PlayerCoordinator
    private let graphViewModel: GraphViewModel
    private let sceneStylesViewModel: SceneStylesViewModel
    private let matcher: SceneDataMatcherProtocol
    
    // MARK: - Private Properties
    
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Computed Properties
    
    var currentSceneIndex: Int? {
        sceneStylesViewModel.currentSceneIndex
    }
    
    var effectiveStyleId: String {
        sceneStylesViewModel.styleIdFromClientData
    }
    
    var audiobook: AudiobookModel {
        sceneStylesViewModel.audiobook
    }
    
    // MARK: - Initialization
    
    init(
        playerCoordinator: PlayerCoordinator,
        graphViewModel: GraphViewModel,
        sceneStylesViewModel: SceneStylesViewModel,
        matcher: SceneDataMatcherProtocol = SceneDataMatcher()
    ) {
        self.playerCoordinator = playerCoordinator
        self.graphViewModel = graphViewModel
        self.sceneStylesViewModel = sceneStylesViewModel
        self.matcher = matcher
        
        setupBindings()
    }
    
    // MARK: - Setup
    
    private func setupBindings() {
        // Listen to graphData changes (changed from $graph to $graphData)
        graphViewModel.$graphData
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.enrichScenesWithGraphData()
            }
            .store(in: &cancellables)
    }
    
    // These will be called from the View's onChange modifiers
    func handleStyleChange() {
        loadScenes()
        
        if let currentIndex = currentSceneIndex {
            selectedSceneIndex = currentIndex
            if currentIndex < scenes.count {
                selectedScene = scenes[currentIndex]
            }
        }
    }
    
    func handleChaptersChange() {
        loadScenes()
        enrichScenesWithGraphData()
    }
    
    func handleCurrentSceneChange(_ newIndex: Int?) {
        if let newIndex = newIndex {
            updateSelectedSceneIndex(newIndex)
        }
    }
    
    // MARK: - Public Methods
    
    func loadInitialData() {
        loadScenes()
        setInitialScene()
        enrichScenesWithGraphData()
    }
    
    func selectScene(_ scene: SceneModel, at index: Int) {
        selectedSceneIndex = index
        selectedScene = scene
        state = .promptDetails
    }
    
    func selectLocation(_ location: LocationModel) {
        selectedLocation = location
        state = .locationDetails
    }
    
    func selectCharacter(_ character: CharacterModel) {
        selectedCharacter = character
        state = .characterDetails
    }
    
    func hideSceneList() {
        playerCoordinator.selectTab(.bookInfo)
    }
    
    func resetState() {
        state = .promptDetails
    }
    
    // MARK: - Private Methods
    
    private func loadScenes() {
        let chapterIndex = sceneStylesViewModel.audiobook.playbackInfo.currentResourceIndex
        
        guard chapterIndex < sceneStylesViewModel.chapters.count else {
            scenes = []
            return
        }
        
        let baseScenes = sceneStylesViewModel.chapters[chapterIndex]
        let styleId = effectiveStyleId
        
        // Apply style-specific images
        scenes = baseScenes.map { scene in
            var modifiedScene = scene
            
            if !styleId.isEmpty,
               let derivedScene = scene.derivedScenes?[styleId],
               !derivedScene.image.isEmpty {
                modifiedScene.image = derivedScene.image
            }
            
            return modifiedScene
        }
    }
    
    private func enrichScenesWithGraphData() {
        // Check for graphData
        guard graphViewModel.graphData != nil else { return }
        
        // Fetch all characters and locations from current chapter
        let characters = graphViewModel.fetchCharactersFromCurrentChapter()
        let locations = graphViewModel.fetchLocationsFromCurrentChapter()
        
        // Skip if no data available
        guard !characters.isEmpty || !locations.isEmpty else { return }
        
        for index in scenes.indices {
            // Match characters
            if let characterNames = scenes[index].characterNames,
               !characterNames.isEmpty,
               !characters.isEmpty {
                scenes[index].characters = matcher.matchCharacters(characterNames, with: characters)
            }
            
            // Match locations
            if let locationNames = scenes[index].locationName,
               let firstLocationName = locationNames.first,
               !locations.isEmpty {
                scenes[index].location = matcher.matchLocation(firstLocationName, with: locations)
            }
        }
    }
    
    private func setInitialScene() {
        selectedSceneIndex = currentSceneIndex ?? 0
        
        if selectedSceneIndex < scenes.count {
            selectedScene = scenes[selectedSceneIndex]
        }
    }
    
    private func updateSelectedSceneIndex(_ newIndex: Int) {
        withAnimation {
            selectedSceneIndex = newIndex
        }
    }
}
