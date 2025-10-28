//
//  SceneCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SceneCell: View {
    let scene: SceneModel
    let isSelected: Bool
    let isCurrent: Bool
    let showPrompt: (SceneModel) -> Void
    let showLocation: (LocationModel) -> Void
    let showCharacter: (CharacterModel) -> Void
    
    private var sceneTitleString: String {
        // "#\(scene.sceneNumber + 1) \(scene.startTime.formatToTimeString()) - \(scene.endTime.formatToTimeString())"
        "#\(scene.sceneNumber + 1)"
    }
    
    @State private var scrollViewContentSize: CGSize = .zero
    
    var body: some View {
        VStack (spacing: 12) {
            sceneTitle
            scenePrompt
            charactersInfo
            locationInfo
        }
        .overlay {
            Rectangle().fill(.white.opacity(0.00001)).opacity(isSelected ? 0.0 : 1.0)
        }
    }
    
    private var sceneTitle: some View {
        Text(sceneTitleString)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .padding(.vertical, 5)
            .padding(.horizontal, 10)
            .background(isCurrent ? Color.customIndigo.gradient : Color.black.gradient, in: .rect(cornerRadius: 6))
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(isSelected ? 1 : 0.72)
    }
    
    @ViewBuilder
    private var scenePrompt: some View {
        if let prompt = scene.prompt {
            Button(action: {
                HapticFeedback.shared.trigger(style: .soft)
                showPrompt(scene)
            }) {
                VStack (alignment: .leading, spacing: 12) {
                    makeSectionTitle(
                        icon: SceneListState.promptDetails.iconList,
                        title: SceneListState.promptDetails.titleList
                    )
                    
                    Text(prompt)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                .padding(12)
                .background(.customDarkGrey.opacity(0.92), in: .rect(cornerRadius: 10))
                .opacity(isSelected ? 1 : 0.72)
            }
        }
    }
    
    @ViewBuilder
    private var charactersInfo: some View {
        if let characters = scene.characters, !characters.isEmpty {
            VStack (alignment: .leading, spacing: 12) {
                makeSectionTitle(
                    icon: SceneListState.characterDetails.iconList,
                    title: SceneListState.characterDetails.titleList
                )
                .padding(.horizontal, 12)
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 6) {
                        ForEach(characters) { character in
                            CharacterCell(
                                character: character,
                                action: { character in
                                    showCharacter(character)
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 12)
                    .background(
                        GeometryReader { geo -> Color in
                            DispatchQueue.main.async {
                                scrollViewContentSize = geo.size
                            }
                            return Color.clear
                        }
                    )
                }
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                .frame(
                    maxWidth: scrollViewContentSize.width
                )
            }
            .padding(.vertical, 12)
            .background(.customDarkGrey.opacity(0.92), in: .rect(cornerRadius: 10))
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(isSelected ? 1 : 0.5)
        }
    }
    
    @ViewBuilder
    private var locationInfo: some View {
        if let location = scene.location {
            VStack (alignment: .leading, spacing: 12) {
                makeSectionTitle(
                    icon: SceneListState.locationDetails.iconList,
                    title: SceneListState.locationDetails.titleList
                )
                
                LocationCell(
                    location: location,
                    action: { location in
                        showLocation(location)
                    }
                )
            }
            .padding(12)
            .background(.customDarkGrey.opacity(0.92), in: .rect(cornerRadius: 10))
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(isSelected ? 1 : 0.5)
        }
    }
    
    private func makeSectionTitle(icon: String, title: String) -> some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundColor(.white)
            
            Text(title)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
        }
    }
}
