//
//  ScenePromptView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct ScenePromptView: View {
    let scene: SceneModel?
    let resetState: () -> Void
    
    private var sceneTitleString: String {
        scene.map { "#\($0.sceneNumber + 1) (\($0.startTime.formatToTimeString()) - \($0.endTime.formatToTimeString()))" }
        ?? "scene_list_scene_details_no_scene_selected_title".localized
    }
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 12) {
                    Spacer(minLength: 0).id("TopView")
                    title
                    description
                }
                .padding(EdgeInsets(top: 44, leading: 14, bottom: 14, trailing: 14))
                .rotationEffect(Angle(degrees: 180))
            }
            .rotationEffect(Angle(degrees: 180))
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
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .soft)
                resetState()
            }
            .onAppear {
                proxy.scrollTo("TopView", anchor: .top)
            }
        }
    }
    
    @ViewBuilder
    private var title: some View {
        SceneTitle(
            icon: SceneListState.promptDetails.iconDetails,
            text: sceneTitleString
        )
    }
    
    @ViewBuilder
    private var description: some View {
        if let scene = scene, let prompt = scene.prompt {
            SceneDescription(text: prompt)
        }
    }
}
