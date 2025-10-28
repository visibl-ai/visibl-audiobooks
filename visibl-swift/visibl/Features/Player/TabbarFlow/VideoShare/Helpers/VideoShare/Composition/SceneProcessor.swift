//
//  SceneProcessor.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation
import UIKit

final class SceneProcessor {
    /// Processes all scenes and creates video instructions
    static func processScenes(
        _ scenes: [SceneModel],
        videoTrack: AVMutableCompositionTrack,
        videoSize: CGSize,
        bookTitle: String,
        authorName: String,
        styleName: String,
        tempFiles: inout [URL],
        progress: VideoShareProgress? = nil
    ) async throws -> [AVMutableVideoCompositionInstruction] {
        let watermarkImage = UIImage(named: "logo")
        let watermarkSize = CGSize(width: 80, height: 80)

        var instructions: [AVMutableVideoCompositionInstruction] = []
        var currentTime = CMTime.zero

        // print("🎬 Processing scenes...")
        // print("📊 Total scenes to process: \(scenes.count)")

        // Calculate total frames across all scenes for smooth progress
        let totalFrames = scenes.reduce(0) { total, scene in
            let duration = scene.endTime - scene.startTime
            return total + Int(ceil(duration * 10))  // 10 FPS
        }

        // Calculate and log total video duration
        let totalDuration = scenes.reduce(0.0) { $0 + ($1.endTime - $1.startTime) }
        let firstSceneStart = scenes.first?.startTime ?? 0
        let lastSceneEnd = scenes.last?.endTime ?? 0
        // print("⏱️ Total video duration: \(totalDuration)s")
        // print("⏱️ Total frames to process: \(totalFrames)")
        // print("⏱️ Timeline span: \(firstSceneStart)s to \(lastSceneEnd)s (book time)")

        var processedFrames = 0

        for (index, scene) in scenes.enumerated() {
            // Check for Swift Task cancellation first
            try Task.checkCancellation()

            // Also check our progress cancellation flag
            if await progress?.isCancelled == true {
                print("⚠️ Video creation cancelled by user")
                throw VideoError.cancelled
            }

            await progress?.update(
                progress: 0.10 + (Double(processedFrames) / Double(totalFrames)) * 0.75,
                message: "Processing scene \(index + 1) of \(scenes.count)..."
            )

            let durationSeconds = scene.endTime - scene.startTime
            // print("\n🎞️ Scene \(index):")
            // print("  - Book time: \(scene.startTime)s → \(scene.endTime)s")
            // print("  - Duration: \(durationSeconds)s")
            // print("  - Video timeline position: \(currentTime.seconds)s → \(currentTime.seconds + durationSeconds)s")

            if durationSeconds <= 0 {
                print("  ⚠️ Skipping scene \(index) with zero or negative duration")
                continue
            }

            let duration = CMTime(seconds: durationSeconds, preferredTimescale: 1000)
            guard let imageUrlString = scene.image,
                  let imageUrl = URL(string: imageUrlString) else {
                print("Invalid image URL for scene \(index): \(String(describing: scene.image))")
                continue
            }

            let sceneFrames = Int(ceil(durationSeconds * 10))  // 10 FPS

            let instruction = try await processScene(
                index: index,
                imageUrl: imageUrl,
                duration: duration,
                currentTime: currentTime,
                videoTrack: videoTrack,
                videoSize: videoSize,
                watermarkImage: watermarkImage,
                watermarkSize: watermarkSize,
                bookTitle: bookTitle,
                authorName: authorName,
                styleName: styleName,
                tempFiles: &tempFiles,
                processedFrames: processedFrames,
                totalFrames: totalFrames,
                progress: progress
            )

            if let instruction = instruction {
                instructions.append(instruction)
                currentTime = CMTimeAdd(currentTime, duration)
                processedFrames += sceneFrames
            }
        }

        return instructions
    }

    // MARK: - Private Helpers

    /// Processes a single scene
    private static func processScene(
        index: Int,
        imageUrl: URL,
        duration: CMTime,
        currentTime: CMTime,
        videoTrack: AVMutableCompositionTrack,
        videoSize: CGSize,
        watermarkImage: UIImage?,
        watermarkSize: CGSize,
        bookTitle: String,
        authorName: String,
        styleName: String,
        tempFiles: inout [URL],
        processedFrames: Int,
        totalFrames: Int,
        progress: VideoShareProgress?
    ) async throws -> AVMutableVideoCompositionInstruction? {
        print("Creating video asset from image: \(imageUrl) for duration: \(CMTimeGetSeconds(duration))")
        let (asset, tempVideoURL) = try await createVideoAsset(
            from: imageUrl,
            duration: duration,
            size: videoSize,
            watermarkImage: watermarkImage,
            watermarkSize: watermarkSize,
            bookTitle: bookTitle,
            authorName: authorName,
            styleName: styleName,
            processedFrames: processedFrames,
            totalFrames: totalFrames,
            progress: progress
        )
        tempFiles.append(tempVideoURL)
        print("Created video segment at: \(tempVideoURL.path)")

        let timeRange = CMTimeRange(start: currentTime, duration: duration)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)

        if videoTracks.isEmpty {
            print("No video track found in the created asset for scene \(index)")
            return nil
        }

        print("Inserting video track for scene \(index) into the composition at time: \(CMTimeGetSeconds(currentTime))")
        try videoTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: duration),
            of: videoTracks[0],
            at: currentTime
        )

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = timeRange

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        instruction.layerInstructions = [layerInstruction]

        return instruction
    }

    /// Creates a video asset from an image
    private static func createVideoAsset(
        from imageUrl: URL,
        duration: CMTime,
        size: CGSize,
        watermarkImage: UIImage?,
        watermarkSize: CGSize,
        bookTitle: String,
        authorName: String,
        styleName: String,
        processedFrames: Int,
        totalFrames: Int,
        progress: VideoShareProgress?
    ) async throws -> (AVAsset, URL) {
        let data = try Data(contentsOf: imageUrl)
        guard let image = UIImage(data: data) else {
            throw VideoError.invalidImage
        }

        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let videoURL = documentsPath.appendingPathComponent("\(UUID().uuidString).mov")

        guard let videoWriter = try? AVAssetWriter(outputURL: videoURL, fileType: .mov) else {
            throw VideoError.failedToCreateVideoWriter
        }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: size.width,
            AVVideoHeightKey: size.height
        ]

        let videoWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoWriterInput.expectsMediaDataInRealTime = false

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoWriterInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
                kCVPixelBufferWidthKey as String: size.width,
                kCVPixelBufferHeightKey as String: size.height
            ]
        )

        videoWriter.add(videoWriterInput)
        videoWriter.startWriting()
        videoWriter.startSession(atSourceTime: .zero)

        let frameDuration = CMTime(value: 1, timescale: 10) // 10 FPS
        let sceneFrames = Int(ceil(duration.seconds * 10))  // Round up to ensure we cover full duration

        // print("📊 DEBUG: Scene video creation details:")
        // print("  - Duration (CMTime): \(duration.seconds)s")
        // print("  - Total frames to generate: \(sceneFrames)")
        // print("  - Frame duration: \(frameDuration.seconds)s (10 FPS)")
        // print("  - Expected final time: \(Double(sceneFrames - 1) * frameDuration.seconds)s")

        var frameCount = 0
        var lastProgressLog = -1  // Track last logged progress percentage

        // Process frames in batches, yielding control when writer isn't ready
        while frameCount < sceneFrames {
            // Check for Swift Task cancellation
            try Task.checkCancellation()

            // Check for cancellation via progress
            if await progress?.isCancelled == true {
                print("⚠️ Scene processing cancelled")
                throw VideoError.cancelled
            }

            // Wait for writer to be ready if needed
            while !videoWriterInput.isReadyForMoreMediaData && frameCount < sceneFrames {
                // Give the writer time to process its buffer
                try await Task.sleep(nanoseconds: 10_000_000) // 10ms
            }

            guard frameCount < sceneFrames else { break }

            // Update smooth progress (10% to 85% range)
            let currentFrame = processedFrames + frameCount
            let smoothProgress = 0.10 + (Double(currentFrame) / Double(totalFrames)) * 0.75
            await progress?.update(
                progress: smoothProgress,
                message: "Processing frames... \(Int(smoothProgress * 100))%"
            )

            let presentationTime = CMTimeMultiply(frameDuration, multiplier: Int32(frameCount))
            // Calculate progress for the progress bar within scene
            let elapsedTime = Double(frameCount) / 10.0  // Current time in seconds (10 FPS)
            let sceneProgress = min(elapsedTime / duration.seconds, 1.0)  // Ensure progress doesn't exceed 1.0

            // Log progress at key milestones (0%, 25%, 50%, 75%, 100%) and first/last frames
            // let progressPercent = Int(sceneProgress * 100)
            // if frameCount == 0 || frameCount == sceneFrames - 1 ||
            //    (progressPercent % 25 == 0 && progressPercent != lastProgressLog) {
            //     print("  📈 Frame \(frameCount)/\(sceneFrames): elapsed=\(elapsedTime)s, progress=\(String(format: "%.1f", sceneProgress * 100))%, presentationTime=\(presentationTime.seconds)s")
            //     lastProgressLog = progressPercent
            // }

            let pixelBuffer = try await PixelBufferRenderer.createPixelBuffer(
                from: image,
                size: size,
                watermarkImage: watermarkImage,
                watermarkSize: watermarkSize,
                progress: sceneProgress,
                bookTitle: bookTitle,
                authorName: authorName,
                styleName: styleName
            )

            adaptor.append(pixelBuffer, withPresentationTime: presentationTime)
            frameCount += 1
        }

        // print("  ✅ Finished writing \(frameCount) frames for scene")

        videoWriterInput.markAsFinished()
        await videoWriter.finishWriting()

        return (AVURLAsset(url: videoURL), videoURL)
    }
}
