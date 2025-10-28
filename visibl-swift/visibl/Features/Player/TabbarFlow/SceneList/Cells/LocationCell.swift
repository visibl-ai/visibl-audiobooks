//
//  LocationCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher
import Shimmer

struct LocationCell: View {
    let location: LocationModel
    let action: (LocationModel) -> Void
    
    var body: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .soft)
            action(location)
        }) {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(.customGray6)
                    .frame(height: 80)
                    .shimmerEffect()
                    .environment(\.colorScheme, .light)
                    .overlay {
                        if let image = location.image {
                            KFImage(URL(string: image))
                                .resizable()
                                .fade(duration: 0.5)
                                // .forceTransition()
                                .aspectRatio(contentMode: .fill)
                                .frame(height: 80)
                                .clipShape(.rect(cornerRadius: 10))
                        }
                    }
                
                Text(location.description?.capitalized ?? "")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: 102)
        }
    }
}
