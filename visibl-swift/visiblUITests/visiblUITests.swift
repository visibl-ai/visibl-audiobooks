//
//  visiblUITests.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import XCTest

final class visiblUITests: XCTestCase {
    let app = XCUIApplication()
    
    override func setUpWithError() throws {
        continueAfterFailure = false
    }
    
    override func tearDownWithError() throws {}
    
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        
        // Get the name of the current test method
        // The name format is typically "-[TestClassName testMethodName]"
        let fullTestName = name
        print("Full test name: \(fullTestName)")
        
        // Extract just the test method name part using a regular expression
        let regex = try! NSRegularExpression(pattern: "\\s(test\\w+)\\]")
        let testNameRange = NSRange(fullTestName.startIndex..<fullTestName.endIndex, in: fullTestName)
        let matches = regex.matches(in: fullTestName, options: [], range: testNameRange)
        
        var testMethodName = ""
        if let match = matches.first, let range = Range(match.range(at: 1), in: fullTestName) {
            testMethodName = String(fullTestName[range])
            print("Extracted test method name: \(testMethodName)")
        } else {
            print("Could not extract test method name")
        }
        
        // Set up the launch arguments
        app.launchArguments = ["--uitesting"]
        
        // Add the specific test case command line argument
        if !testMethodName.isEmpty {
            let testCaseArg = "--testCase=\(testMethodName)"
            app.launchArguments.append(testCaseArg)
            print("Added command line argument: \(testCaseArg)")
        }
        
        app.launch()
        
        // Wait for the test ready indicator
        let predicate = NSPredicate(format: "exists == true")
        let testReadyIndicator = app.staticTexts["TestReadyIndicator"]
        let expectation = self.expectation(for: predicate, evaluatedWith: testReadyIndicator, handler: nil)
        wait(for: [expectation], timeout: 15)
    }
    
    @MainActor
    func testAudiobookAddFromCatalogue() throws {
        app.buttons["Book Store"].tap()
        let bookImage = app.images.element(boundBy: 1)
        XCTAssertTrue(bookImage.waitForExistence(timeout: 15), "Book image did not appear in time")
        bookImage.tap()
        let getButton = app.staticTexts["Get This Book"]
        XCTAssertTrue(getButton.waitForExistence(timeout: 5), "Get This Book button did not appear in time")
        getButton.tap()
    }
    
    @MainActor
    func testAudiobookPlayPause() throws {
        sleep(15)
        app.scrollViews.images.firstMatch.tap()
        sleep(3)
        
        // Wait for player to start - should show pause button when playing
        let pauseButton = app.images["pause.fill"]
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 30), "Pause button not found - player may not have started")
        
        sleep(3)
        
        // Get initial time - use the broader search that found the time element
        let timeIndicator = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS ':'")).element(boundBy: 0)
        XCTAssertTrue(timeIndicator.exists, "Time indicator not found")
        
        let initialTime = timeIndicator.label
        print("Initial time: \(initialTime)")
        sleep(10)
        
        // Check if time changed
        let updatedTime = timeIndicator.label
        print("Updated time: \(updatedTime)")
        XCTAssertNotEqual(initialTime, updatedTime, "Playback time did not change, suggesting audio is not playing")
        
        // Tap center of screen to pause playback
        let screenCenter = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        screenCenter.tap()
        sleep(3)
        
        // After pausing, should show play button
        let playButton = app.images["play.fill"]
        XCTAssertTrue(playButton.exists, "Play button not found after tapping pause")
        
        let timeAfterPause = timeIndicator.label
        sleep(5)
        let timeAfterWaiting = timeIndicator.label
        XCTAssertEqual(timeAfterPause, timeAfterWaiting, "Time continued to change after pause was pressed")
    }
}
