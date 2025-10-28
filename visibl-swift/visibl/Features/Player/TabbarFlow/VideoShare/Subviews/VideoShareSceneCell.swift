//
//  VideoShareSceneCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct VideoShareSceneCell: View {
    let scene: SceneModel
    var isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        if let imageURLString = scene.image {
            VStack(spacing: 4) {
                KFImage(URL(string: imageURLString))
                    .resizable()
                    .placeholder {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.customDarkGrey))
                            .frame(width: 120, height: 120)
                    }
                    .fade(duration: 0.6)
                    .scaledToFill()
                    .frame(width: 120, height: 120)
                    .cornerRadius(12)
                    .clipped()
                    .overlay(alignment: .bottomLeading) {
                        Text("#\(scene.sceneNumber + 1)")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 50, height: 22)
                            .background(Color(.customDarkGrey))
                            .cornerRadius(6)
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                
                Text("\(String.formatTime(scene.startTime)) - \(String.formatTime(scene.endTime))")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(width: 120)
                    .frame(height: 20)
                    .background(Color(.customDarkGrey), in: .rect(cornerRadius: 10))
            }
            .padding(4)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.white : Color.clear, lineWidth: 1)
            )
            .padding(.vertical, 1)
            .onTapGesture {
                action()
            }
        }
    }
}
