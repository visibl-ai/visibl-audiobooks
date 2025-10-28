//
//  GraphViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Combine
import FirebaseDatabase

final class GraphViewModel: ObservableObject {
    @Published var audiobook: AudiobookModel
    @Published var graphData: GraphDataModel?
    
    private let player: AudioPlayerManager
    private var cancellables = Set<AnyCancellable>()
    private let databaseManager = RTDBManager.shared
    
    private var graphHandle: DatabaseHandle?
    private var currentGraphPath: String?
    
    init(audiobook: AudiobookModel, player: AudioPlayerManager) {
        self.audiobook = audiobook
        self.player = player
        bind()
    }
}

extension GraphViewModel {
    private func bind() {
        player.$audiobook
            .compactMap { $0?.playbackInfo.currentResourceIndex }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.unsubscribeFromGraph()
                self.subscribeForGraph()
            }
            .store(in: &cancellables)
    }
}

extension GraphViewModel {
    private func subscribeForGraph() {
        guard let graphId = audiobook.publication.defaultGraphId else {
            print("No default graph ID found for \(audiobook.id)")
            return
        }
        
        let path = "graphs/\(graphId)"
        currentGraphPath = path
        
        // Observe the GraphData structure
        graphHandle = databaseManager.observeSingleObject(
            at: path,
            type: GraphDataModel.self
        ) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let graphData):
                    self?.graphData = graphData
                case .failure(let error):
                    print("Failed to observe graph:", error)
                }
            }
        }
    }
    
    private func unsubscribeFromGraph() {
        guard
            let path = currentGraphPath,
            let handle = graphHandle
        else { return }
        
        databaseManager.removeObserver(handle: handle, at: path)
        
        graphHandle = nil
        currentGraphPath = nil
        graphData = nil
    }
}

extension GraphViewModel {
    func fetchCharactersFromCurrentChapter() -> [CharacterModel] {
        guard let chapters = graphData?.chapters,
              let currentChapterIndex = player.audiobook?.playbackInfo.currentResourceIndex,
              currentChapterIndex < chapters.count,
              let currentChapter = chapters[currentChapterIndex] else {  // Unwrap optional chapter
            return []
        }
        
        return currentChapter.charactersArray
    }

    func fetchLocationsFromCurrentChapter() -> [LocationModel] {
        guard let chapters = graphData?.chapters,
              let currentChapterIndex = player.audiobook?.playbackInfo.currentResourceIndex,
              currentChapterIndex < chapters.count,
              let currentChapter = chapters[currentChapterIndex] else {  // Unwrap optional chapter
            return []
        }
        
        return currentChapter.locationsArray
    }
}
