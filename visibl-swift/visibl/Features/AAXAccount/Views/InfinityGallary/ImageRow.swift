//
//  ImageRow.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct ImageRow: View {
    let images: [ImageSetModel]
    let scrollSpeed: Double
    
    @State private var contentWidth: CGFloat = 0
    @State private var time: Date = Date()
    
    var body: some View {
        GeometryReader { geometry in
            let rowHeight = geometry.size.height
            //let rowWidth = geometry.size.width
            
            TimelineView(.animation) { context in
                let elapsed = context.date.timeIntervalSinceReferenceDate
                let animationOffset = -CGFloat(elapsed * scrollSpeed * 10).truncatingRemainder(dividingBy: contentWidth == 0 ? 1 : contentWidth)
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(images) { imageSet in
                            Image(imageSet.image)
                                .resizable()
                                .scaledToFit()
                                .frame(height: rowHeight)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        
                        ForEach(images) { imageSet in
                            Image(imageSet.image)
                                .resizable()
                                .scaledToFit()
                                .frame(height: rowHeight)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    .background(
                        GeometryReader { contentGeometry in
                            Color.clear.onAppear {
                                contentWidth = contentGeometry.size.width / 2
                            }
                        }
                    )
                    .offset(x: animationOffset)
                }
                .allowsHitTesting(false)
            }
        }
        .frame(height: UIScreen.main.bounds.height * 0.175)
    }
}
