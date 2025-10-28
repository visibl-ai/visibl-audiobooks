//
//  VideoShareConfiguration.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import CoreGraphics

struct VideoShareConfiguration {
    let scenes: [SceneModel]
    let audioUrlString: String
    let bookId: String
    let bookTitle: String
    let authorName: String
    let styleName: String
    let isLocalFile: Bool
    let m4bUrl: String?
    let chapterStartTime: TimeInterval?
    let chapterEndTime: TimeInterval?
    let videoSize: CGSize

    init(
        scenes: [SceneModel],
        audioUrlString: String,
        bookId: String,
        bookTitle: String,
        authorName: String,
        styleName: String,
        isLocalFile: Bool,
        m4bUrl: String? = nil,
        chapterStartTime: TimeInterval? = nil,
        chapterEndTime: TimeInterval? = nil,
        videoSize: CGSize = CGSize(width: 464, height: 848)
    ) {
        self.scenes = scenes
        self.audioUrlString = audioUrlString
        self.bookId = bookId
        self.bookTitle = bookTitle
        self.authorName = authorName
        self.styleName = styleName
        self.isLocalFile = isLocalFile
        self.m4bUrl = m4bUrl
        self.chapterStartTime = chapterStartTime
        self.chapterEndTime = chapterEndTime
        self.videoSize = videoSize
    }
}
