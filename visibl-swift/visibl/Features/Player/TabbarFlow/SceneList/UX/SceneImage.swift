//
//  SceneImage.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct SceneImage: View {
    let imageURL: URL?
    @State private var imageWidth: CGFloat = .zero

    var body: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(Color.gray)
            .overlay {
                KFImage(imageURL)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .background(.white)
            }
            .frame(height: imageWidth)
            .clipShape(.rect(cornerRadius: 16))
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear {
                            imageWidth = geo.size.width
                        }
                        .onChange(of: geo.size.width) { _, newWidth in
                            imageWidth = newWidth
                        }
                }
            )
    }
}
