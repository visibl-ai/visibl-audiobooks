//
//  VideoShareCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation

final class VideoShareCoordinator {
    /// Creates a video from configuration
    static func createVideo(config: VideoShareConfiguration, progress: VideoShareProgress? = nil) async throws -> URL {
        var tempFiles: [URL] = []
        var gcsPathsToDelete: [String] = []
        var finalVideoURL: URL!

        defer {
            // Clean up local temp files
            print("Cleaning up temp files...")
            for tempFile in tempFiles {
                print("Removing temp file: \(tempFile.path)")
                try? FileManager.default.removeItem(at: tempFile)
            }

            // Clean up GCS files
            for gcsPath in gcsPathsToDelete {
                print("Deleting GCS file: \(gcsPath)")
                Task {
                    try? await CloudStorageManager.shared.deleteFile(at: gcsPath)
                }
            }
        }

        do {
            guard let firstScene = config.scenes.first,
                  let lastScene = config.scenes.last else {
                throw VideoError.noScenes
            }

            // print("\n🎬 === VIDEO SHARE COORDINATOR START ===")
            // print("📚 Book: \(config.bookTitle)")
            // print("🎨 Style: \(config.styleName)")
            // print("📍 Scene range: \(firstScene.startTime)s → \(lastScene.endTime)s")
            // print("⏱️ Total duration: \(lastScene.endTime - firstScene.startTime)s")
            // print("🎞️ Number of scenes: \(config.scenes.count)")

            // Step 1: Prepare audio
            // print("\n🔊 Step 1: Preparing audio...")
            await progress?.update(progress: 0.05, message: "Preparing audio...")

            let (audioFile, needsTrimming) = try await AudioPreparationService.prepareAudio(
                config: config,
                sceneStartTime: firstScene.startTime,
                sceneEndTime: lastScene.endTime
            )
            // print("  - Audio file: \(audioFile.localURL.lastPathComponent)")
            // print("  - Needs trimming: \(needsTrimming)")

            // Track GCS path if present
            if let gcsPath = audioFile.gcsPath {
                gcsPathsToDelete.append(gcsPath)
                // print("  - GCS path tracked for cleanup: \(gcsPath)")
            }

            // Track local file if not local
            if !config.isLocalFile {
                tempFiles.append(audioFile.localURL)
            }

            // Step 2: Trim audio if needed
            let trimmedAudioFile: AudioFile
            if needsTrimming {
                // print("\n✂️ Step 2: Trimming audio to match scene range...")
                // print("  - Trim range: \(firstScene.startTime)s → \(lastScene.endTime)s")
                trimmedAudioFile = try await AudioPreparationService.trimAudio(
                    file: audioFile,
                    startTime: firstScene.startTime,
                    endTime: lastScene.endTime
                )
                tempFiles.append(trimmedAudioFile.localURL)
                // print("  - Trimmed audio saved: \(trimmedAudioFile.localURL.lastPathComponent)")
            } else {
                // print("\n✅ Step 2: Audio already trimmed, skipping trim step")
                trimmedAudioFile = audioFile
            }

            // Step 3: Create video composition
            // print("\n🎥 Step 3: Creating video composition...")
            await progress?.update(progress: 0.15, message: "Creating composition...")

            let (composition, videoComposition, videoTrack, audioTrack) = try VideoCompositionBuilder.createComposition(
                size: config.videoSize
            )
            // print("  - Video size: \(config.videoSize.width)x\(config.videoSize.height)")

            // Step 4: Process scenes
            // print("\n🎞️ Step 4: Processing scenes into video segments...")
            await progress?.update(progress: 0.20, message: "Processing scenes...")

            let instructions = try await SceneProcessor.processScenes(
                config.scenes,
                videoTrack: videoTrack,
                videoSize: config.videoSize,
                bookTitle: config.bookTitle,
                authorName: config.authorName,
                styleName: config.styleName,
                tempFiles: &tempFiles,
                progress: progress
            )

            if instructions.isEmpty {
                throw VideoError.noScenes
            }
            // print("  - Generated \(instructions.count) video composition instructions")

            // Step 5: Add audio
            // print("\n🔊 Step 5: Adding audio to composition...")
            await progress?.update(progress: 0.85, message: "Adding audio...")

            // print("  - Audio source: \(trimmedAudioFile.localURL.lastPathComponent)")
            try await VideoCompositionBuilder.addAudio(
                to: audioTrack,
                from: trimmedAudioFile.localURL,
                composition: composition
            )
            // print("  - Audio track added successfully")

            // Step 6: Set instructions
            // print("\n📝 Step 6: Setting video composition instructions...")
            videoComposition.instructions = instructions

            // Step 7: Export video
            // print("\n💾 Step 7: Exporting final video...")
            await progress?.update(progress: 0.90, message: "Exporting video...")

            finalVideoURL = try await VideoExporter.export(
                composition: composition,
                videoComposition: videoComposition
            )

            await progress?.update(progress: 1.0, message: "Complete!")

            // print("  - Export completed: \(finalVideoURL.lastPathComponent)")
            // print("\n✅ === VIDEO SHARE COORDINATOR COMPLETE ===")
            // print("📹 Final video: \(finalVideoURL.path)")
        } catch {
            print("Error creating video: \(error.localizedDescription)")
            if let nsError = error as NSError? {
                print("Error domain: \(nsError.domain), code: \(nsError.code)")
            }
            throw error
        }

        return finalVideoURL
    }
}
