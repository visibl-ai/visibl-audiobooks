//
//  InfinityGallary.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct InfinityGallary: View {
    private let imageNames1 = ["book_cover_1", "book_cover_2", "book_cover_3", "book_cover_4", "book_cover_5", "book_cover_6", "book_cover_7", "book_cover_8", "book_cover_9"]
    private let imageNames2 = ["book_cover_10", "book_cover_11", "book_cover_12", "book_cover_13", "book_cover_14", "book_cover_15", "book_cover_16", "book_cover_17", "book_cover_18"]
    private let imageNames3 = ["book_cover_19", "book_cover_20", "book_cover_21", "book_cover_22", "book_cover_23", "book_cover_24", "book_cover_25", "book_cover_26", "book_cover_27"]
    
    private let scrollSpeeds: [Double] = [2.2, 1.8, 2.8]
    
    private var repeatedSet1: [ImageSetModel] {
        imageNames1.map { ImageSetModel(image: $0) }
    }
    
    private var repeatedSet2: [ImageSetModel] {
        imageNames2.map { ImageSetModel(image: $0) }
    }
    
    private var repeatedSet3: [ImageSetModel] {
        imageNames3.map { ImageSetModel(image: $0) }
    }
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 8) {
                ImageRow(images: repeatedSet1, scrollSpeed: scrollSpeeds[0])
                ImageRow(images: repeatedSet2, scrollSpeed: scrollSpeeds[1])
                ImageRow(images: repeatedSet3, scrollSpeed: scrollSpeeds[2])
                ImageRow(images: repeatedSet1, scrollSpeed: scrollSpeeds[0])
                ImageRow(images: repeatedSet2, scrollSpeed: scrollSpeeds[1])
                ImageRow(images: repeatedSet3, scrollSpeed: scrollSpeeds[2])
            }
            .padding(.top, -UIScreen.main.bounds.height * 0.175 / 2)
            .clipped()
        }
    }
}
