//
//  SceneListContent.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SceneListContent: View {
    let scenes: [SceneModel]
    @Binding var selectedSceneIndex: Int
    let currentSceneIndex: Int?
    let sceneSelected: (SceneListState, SceneModel) -> Void
    let locationSelected: (SceneListState, LocationModel?) -> Void
    let characterSelected: (SceneListState, CharacterModel?) -> Void
    let hideAction: () -> Void
    
    var body: some View {
        ScrollViewReader { vScrollProxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 16) {
                    ForEach(Array(scenes.enumerated()), id: \.offset) { index, scene in
                        SceneCell(
                            scene: scene,
                            isSelected: index == selectedSceneIndex,
                            isCurrent: index == currentSceneIndex,
                            showPrompt: { scene in
                                sceneSelected(.promptDetails, scene)
                            },
                            showLocation: { location in
                                locationSelected(.locationDetails, location)
                            },
                            showCharacter: { character in
                                characterSelected(.characterDetails, character)
                            }
                        )
                        .id(index)
                        .onTapGesture {
                            let generator = UIImpactFeedbackGenerator(style: .light)
                            generator.impactOccurred()
                            
                            selectedSceneIndex = index
                            
                            withAnimation {
                                vScrollProxy.scrollTo(index, anchor: .center)
                            }
                        }
                    }
                }
                .padding(EdgeInsets(top: 44, leading: 24, bottom: 24, trailing: 24))
            }
            .onAppear {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    withAnimation {
                        vScrollProxy.scrollTo(selectedSceneIndex, anchor: .center)
                    }
                }
            }
            .onTapGesture {
                hideAction()
            }
        }
        .mask(
            VStack(spacing: 0) {
                LinearGradient(
                    gradient: Gradient(colors: [Color.black.opacity(0), Color.black]),
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 44)
                
                Rectangle()
                    .fill(Color.black)
            }
        )
    }
}
