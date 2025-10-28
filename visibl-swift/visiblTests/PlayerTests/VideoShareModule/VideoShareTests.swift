//
//  VideoShareTests.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import XCTest
import Foundation

final class VideoShareTests: XCTestCase {
    private let mockFileURL = "/o/Catalogue%2FProcessed%2FVISIBL_000003%2FVISIBL_000003-ch0.m4a?alt=media&token=4690ed41-ea29-4cd0-89b0-d99fbeae87ff"
    
    private let mockScenes = [
        SceneModel(
            sceneNumber: 0,
            startTime: 0.0,
            endTime: 5.0,
            image: ConstantsMock.storageURL + "/Scenes/cr6H8imxr7HsAWPYqMGW/0_scene0_1727365128604.9.16.webp",
            sceneId: "cr6H8imxr7HsAWPYqMGW",
            prompt: nil,
            description: nil,
            chapter: nil
        ),
        SceneModel(
            sceneNumber: 1,
            startTime: 5.0,
            endTime: 10.0,
            image: ConstantsMock.storageURL + "/Scenes/cr6H8imxr7HsAWPYqMGW/0_scene1_1727365128604.9.16.webp",
            sceneId: "cr6H8imxr7HsAWPYqMGW",
            prompt: nil,
            description: nil,
            chapter: nil
        )
    ]
    
    func testVideoShareForCatalogue_Success() async {
        do {
            let result = try await VideoShareHelper.createVideo(
                from: mockScenes,
                audioUrlString: ConstantsMock.firebaseStorageURL + mockFileURL,
                bookId: "test_id",
                bookTitle: "Around the World in 80 Days",
                authorName: "Jules Verne",
                styleName: "Origin",
                isLocalFile: false
            )
            
            XCTAssertTrue(FileManager.default.fileExists(atPath: result.path))
            XCTAssertTrue(result.lastPathComponent.contains("Video to Share.mp4"))
            
            try? FileManager.default.removeItem(at: result)
        } catch {
            XCTFail("Error: \(error)")
        }
    }
}
