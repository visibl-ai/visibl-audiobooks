//
//  LocationDetailsView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct LocationDetailsView: View {
    let location: LocationModel?
    let resetState: () -> Void
    
    @State private var imageWidth: CGFloat = .zero
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 12) {
                    Spacer(minLength: 0).id("TopView")
                    title
                    image
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
        if let name = location?.name {
            SceneTitle(
                icon: SceneListState.locationDetails.iconDetails,
                text: name.capitalized
            )
        }
    }
    
    @ViewBuilder
    private var image: some View {
        if let image = location?.image {
            SceneImage(imageURL: URL(string: image))
        }
    }
    
    @ViewBuilder
    private var description: some View {
        if let description = location?.description {
            SceneDescription(text: description)
        }
    }
}
