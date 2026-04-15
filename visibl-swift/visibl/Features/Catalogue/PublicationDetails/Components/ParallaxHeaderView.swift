//
//  ParallaxHeaderView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct ParallaxHeaderView: View {
    let publication: PublicationPreviewModel
    @State private var height: CGFloat = .zero
    
    init(publication: PublicationPreviewModel) {
        self.publication = publication
    }
    
    var body: some View {
        GeometryReader { geometry in
            let offsetY = geometry.frame(in: .global).minY
            let isScrolled = offsetY > 0

            VStack(alignment: .center, spacing: 24) {
                Spacer()

                KFImage(URL(string: publication.cover ?? ""))
                    .placeholder {
                        Image(systemName: "book.closed.fill")
                            .font(.system(size: 52))
                    }
                    .resizable()
                    .scaledToFill()
                    .frame(
                        width: 208,
                        height: 208
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)

                VStack(alignment: .center, spacing: 8) {
                    Text(publication.title)
                        .font(.system(size: 24, weight: .bold, design: .serif))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(publication.authors.joined(separator: ", "))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.gray)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 32)
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear {
                            if height == .zero {
                                height = proxy.size.height
                            }
                        }
                }
            }
            .frame(height: isScrolled ? height + offsetY : height)
            .background {
                KFImage(URL(string: publication.cover ?? ""))
                    .placeholder {
                        Image(systemName: "photo.fill")
                    }
                    .resizable()
                    .scaledToFill()
                    .blur(radius: 30, opaque: true)
                    .clipped()
                    .overlay {
                        Color.black.opacity(0.25)
                    }
            }
            .offset(y: isScrolled ? -offsetY : 0)
            .scaleEffect(isScrolled ? offsetY / 2000 + 1 : 1)
        }
        .frame(height: height)
    }
}
