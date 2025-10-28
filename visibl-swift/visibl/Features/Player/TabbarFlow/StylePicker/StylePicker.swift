//
//  StylePicker.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct StylePicker: View {
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    @Bindable var sceneStylesViewModel: SceneStylesViewModel
    private let analytics: AnalyticsManager = .shared
    
    var body: some View {
        VStack(spacing: 12) {
            topPlaceholder
            
            VStack(spacing: 8) {
                title
                styleList
                createNewStyleButton
                    .padding(EdgeInsets(top: 0, leading: 14, bottom: 14, trailing: 14))
            }
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .black.opacity(0.75)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .trackScreenView(
            "Style Picker",
            properties: [
                "book_id": playerViewModel.audiobook.id,
                "book_title": playerViewModel.audiobook.title,
                "author": playerViewModel.audiobook.authors,
                "is_AAX": playerViewModel.audiobook.isAAX
            ]
        )
    }
    
    private var topPlaceholder: some View {
        Color.white.opacity(0.001)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .medium)
                playerCoordinator.selectTab(.bookInfo)
            }
    }
    
    private var title: some View {
        HStack(spacing: 8) {
            Image(systemName: "paintbrush")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
            Text("Styles")
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
    }
    
    private var styleList: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack (spacing: 14) {
                    ForEach(Array(sceneStylesViewModel.styles ?? [:]).sorted(by: { $0.key < $1.key }), id: \.key) { id, style in
                        StylePickerCell(
                            title: style.title,
                            prompt: style.prompt,
                            isSelected: sceneStylesViewModel.currentStyleId == id,
                            isUserDefault: style.title == "Origin",
                            action: {
                                sceneStylesViewModel.currentStyleId = id
                                sceneStylesViewModel.updateCurrentStyle(id)
                                
                                withAnimation() {
                                    proxy.scrollTo(sceneStylesViewModel.currentStyleId, anchor: .center)
                                }
                                
                                analytics.captureEvent(
                                    "Style Selected",
                                    properties: [
                                        "style_id": id,
                                        "style_prompt": style.prompt
                                    ]
                                )
                            }
                        )
                        .id(id)
                    }
                }
                .padding(EdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 14))
            }
            .onAppear {
                proxy.scrollTo(sceneStylesViewModel.currentStyleId, anchor: .center)
            }
        }
    }
    
    private var createNewStyleButton: some View {
        PlayerActionButton(
            text: "Create New Style",
            action: {
                playerCoordinator.selectTab(.generateNewStyle)
            }
        )
    }
}
