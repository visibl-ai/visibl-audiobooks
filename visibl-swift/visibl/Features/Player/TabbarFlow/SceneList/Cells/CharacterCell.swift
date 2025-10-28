//
//  CharacterCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher
import Shimmer

struct CharacterCell: View {
    let character: CharacterModel
    let action: (CharacterModel) -> Void
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .soft)
            action(character)
        }) {
            VStack(spacing: 6) {
                Circle()
                    .fill(.customGray6)
                    .frame(width: 80, height: 80)
                    .shimmerEffect()
                    .environment(\.colorScheme, .light)
                    .overlay {
                        if let image = character.profileImage {
                            KFImage(URL(string: image))
                                .resizable()
                                .fade(duration: 0.5)
                                // .forceTransition()
                                .scaledToFit()
                                .frame(width: 80, height: 80)
                                .background(.white)
                                .clipShape(.circle)
                        }
                    }
                
                Text(character.name.capitalized)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(.white)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .top)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 102)
        }
    }
}
