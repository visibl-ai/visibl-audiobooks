//
//  PlayerVideoShareView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerVideoShareView: View {
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    @Bindable var sceneStylesViewModel: SceneStylesViewModel
    @ObservedObject var videoShareProgress: VideoShareProgress

    @State private(set) var selectedScenes = Set<SceneModel>()
    @State private var availableScenes: [SceneModel] = []
    @State private var firstSelectedScene: SceneModel?
    @State private var shareableVideoURL: URL?
    @State private var currentVideoTask: Task<Void, Never>?
    
    private var currentChapterAudioUrlString: String {
        let readingOrder = playerViewModel.audiobook.readingOrder
        let currentIndex = playerViewModel.audiobook.playbackInfo.currentResourceIndex
        return readingOrder[currentIndex].url?.absoluteString ?? ""
    }

    private var isAAX: Bool { playerViewModel.audiobook.aaxInfo != nil }
    private var aaxLocalFileName: String { "" }
    private var currectChapterIndex: Int { playerViewModel.audiobook.playbackInfo.currentResourceIndex }
    private var localFilePath: String { aaxLocalFileName + "/" + String(currectChapterIndex) + ".m4a" }

    private var m4bUrl: String? {
        playerViewModel.audiobook.userLibraryItem.content?.m4b?.url.absoluteString
    }

    private var currentChapter: ChapterModel? {
        let readingOrder = playerViewModel.audiobook.readingOrder
        let currentIndex = playerViewModel.audiobook.playbackInfo.currentResourceIndex
        guard currentIndex < readingOrder.count else { return nil }
        return readingOrder[currentIndex]
    }
    
    var body: some View {
        VStack {
            Color.white.opacity(0.001)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onTapGesture {
                    HapticFeedback.shared.trigger(style: .medium)
                    
                    withAnimation {
                        playerCoordinator.selectedTab = .bookInfo
                    }
                }
            
            VStack(spacing: 8) {
                title
                sceneList
                createButton
            }
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .black.opacity(0.75)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .sheet(item: $shareableVideoURL) { videoURL in
            ShareSheet(activityItems: [videoURL])
                .onDisappear {
                    shareableVideoURL = nil
                }
                .presentationDetents([.medium, .large])
                .presentationCornerRadius(24)
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            fetchSharableSceneRow()
        }
        .trackScreenView(
            "Video Share",
            properties: [
                "book_id": playerViewModel.audiobook.id,
                "book_title": playerViewModel.audiobook.title,
                "author": playerViewModel.audiobook.authors,
                "is_AAX": playerViewModel.audiobook.isAAX
            ]
        )
    }
    
    private var title: some View {
        HStack(spacing: 8) {
            Image(systemName: "movieclapper")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
            Text("Video Share")
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
    }
    
    private var sceneList: some View {
        ScrollViewReader { proxy in
            ScrollView (.horizontal, showsIndicators: false) {
                VStack {
                    HStack (spacing: 12) {
                        ForEach(availableScenes, id: \.sceneNumber) { scene in
                            VideoShareSceneCell(
                                scene: getSceneWithCurrentStyle(scene),
                                isSelected: selectedScenes.contains(scene)
                            ) {
                                selectRange(to: scene)
                            }
                            .id(scene.sceneNumber)
                        }
                    }
                    .padding(.horizontal, 14)
                }
            }
            .frame(height: 160)
            .onAppear {
                preselectCurrentScene(proxy: proxy)
            }
        }
    }
    
    private var createButton: some View {
        PlayerActionButton(
            text: "Share Video",
            action: {
                Task {
                    await createVideo()
                }
            }
        )
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        .trackButtonTap("Share Video")
    }
}

private extension PlayerVideoShareView {
    
    // Get scene with the current style applied (similar to getSceneImageURLString in NewStyleViewModel)
    private func getSceneWithCurrentStyle(_ scene: SceneModel) -> SceneModel {
        // Get current style from the audiobook
        let currentStyleId = sceneStylesViewModel.audiobook.sceneStyleInfo.currentSceneStyle
        
        // Check if this scene has a derived version for the current style
        if let styleId = currentStyleId,
           let derivedScene = scene.derivedScenes?[styleId] {
            // Create a new scene with the derived image
            var modifiedScene = scene
            modifiedScene.image = derivedScene.image
            return modifiedScene
        }
        
        // Return original scene with its default image
        return scene
    }
    
    private func selectRange(to scene: SceneModel) {
        // Tapping on selected scene - reset to just that scene
        if selectedScenes.contains(scene) {
            firstSelectedScene = scene
            selectedScenes = [scene]
            return
        }

        // Tapping on unselected scene - extend the range
        if !selectedScenes.isEmpty {
            let sortedSelected = selectedScenes.sorted { $0.sceneNumber < $1.sceneNumber }
            let minScene = sortedSelected.first!
            let maxScene = sortedSelected.last!

            guard let minIndex = availableScenes.firstIndex(of: minScene),
                  let maxIndex = availableScenes.firstIndex(of: maxScene),
                  let tappedIndex = availableScenes.firstIndex(of: scene) else {
                return
            }

            let lowerBound = min(minIndex, tappedIndex)
            let upperBound = max(maxIndex, tappedIndex)
            let range = availableScenes[lowerBound...upperBound]
            selectedScenes = Set(range)
        } else {
            // No selection yet - start new selection
            firstSelectedScene = scene
            selectedScenes = [scene]
        }
    }
    
    @MainActor
    private func createVideo() async {
        if selectedScenes.isEmpty {
            Toastify.show(style: .warning, message: "Please select a range of scenes to create a video.")
            return
        }

        // Cancel any existing video task
        currentVideoTask?.cancel()

        // Sort selected scenes and apply current style to each
        let sortedScenes = Array(selectedScenes).sorted { $0.sceneNumber < $1.sceneNumber }
        let styledScenes = sortedScenes.map { getSceneWithCurrentStyle($0) }

        videoShareProgress.show()

        // Create new task
        let task = Task {
            // Small delay for better UX - allows progress view to appear smoothly
            try? await Task.sleep(nanoseconds: 200_000_000) // 0.2s delay

            // Check if task was cancelled
            guard !Task.isCancelled else { return }

            do {
                let finalVideoUrl = try await VideoShareHelper.createVideo(
                    from: styledScenes,
                    audioUrlString: isAAX ? localFilePath : currentChapterAudioUrlString,
                    bookId: sceneStylesViewModel.audiobook.id,
                    bookTitle: sceneStylesViewModel.audiobook.title,
                    authorName: sceneStylesViewModel.audiobook.authors.joined(separator: ", "),
                    styleName: sceneStylesViewModel.currentStyleTitle ?? "Default Style",
                    isLocalFile: isAAX,
                    m4bUrl: m4bUrl,
                    chapterStartTime: currentChapter?.startTime,
                    chapterEndTime: currentChapter?.endTime,
                    progress: videoShareProgress
                )

                // Check if cancelled before showing result
                guard !Task.isCancelled else {
                    videoShareProgress.hide()
                    currentVideoTask = nil
                    return
                }

                videoShareProgress.hide()
                self.shareableVideoURL = finalVideoUrl
                currentVideoTask = nil

            } catch {
                videoShareProgress.hide()
                currentVideoTask = nil

                if Task.isCancelled || error is CancellationError || (error as? VideoError) == .cancelled {
                    print("Video creation cancelled by user")
                } else {
                    print("Error creating video: \(error.localizedDescription)")
                    Toastify.show(style: .error, message: "Failed to create video")
                }
            }

        }

        // Store task reference and set up cancel callback
        currentVideoTask = task
        videoShareProgress.onCancel = {
            task.cancel()
        }
    }
    
    private func fetchSharableSceneRow() {
        // Get current chapter index and ensure it's valid
        let chapterIndex = sceneStylesViewModel.audiobook.playbackInfo.currentResourceIndex
        guard chapterIndex < sceneStylesViewModel.chapters.count else {
            return
        }
        
        // Get the current chapter's scenes
        let currentChapter = sceneStylesViewModel.chapters[chapterIndex]
        
        // Ensure currentSceneIndex is non-nil and valid
        guard let currentIndex = sceneStylesViewModel.currentSceneIndex,
              currentIndex < currentChapter.count,
              !currentChapter.isEmpty else {
            return
        }
        
        let count = currentChapter.count
        
        // Boundaries for the "row" of scenes around currentIndex
        let lowerBound = max(0, currentIndex - 3)
        let upperBound = min(count - 1, currentIndex + 3)
        
        let availableScenes = Array(currentChapter[lowerBound...upperBound])
        self.availableScenes = availableScenes
    }

    private func preselectCurrentScene(proxy: ScrollViewProxy) {
        // Get current chapter index and ensure it's valid
        let chapterIndex = sceneStylesViewModel.audiobook.playbackInfo.currentResourceIndex
        guard chapterIndex < sceneStylesViewModel.chapters.count else {
            return
        }
        
        // Get the current chapter's scenes
        let currentChapter = sceneStylesViewModel.chapters[chapterIndex]
        
        // Ensure currentSceneIndex is non-nil and within bounds
        guard let currentIndex = sceneStylesViewModel.currentSceneIndex,
              currentIndex < currentChapter.count else {
            return
        }
        
        let currentScene = currentChapter[currentIndex]
        
        // Preselect & scroll to the current scene
        firstSelectedScene = currentScene
        selectedScenes.insert(currentScene)
        
        DispatchQueue.main.async {
            withAnimation {
                proxy.scrollTo(currentScene.sceneNumber, anchor: .center)
            }
        }
    }
}
