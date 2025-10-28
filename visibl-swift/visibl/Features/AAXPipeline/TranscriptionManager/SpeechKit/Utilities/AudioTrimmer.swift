//
//  AudioTrimmer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation

final class AudioTrimmer: ObservableObject {
    @Published var currentChunk = 0
    @Published var totalChunks = 0
    private let chunkDuration: Double = 45.0
    private let overlapDuration: Double = 2.0
    
    // MARK: - Strategy-specific methods
    
    /// Creates a single chunk for sequential processing
    func createSingleChunk(sourceURL: URL, chunkIndex: Int, totalDuration: Double, enableLogging: Bool = true) async -> ChunkInfo? {
        let chunkInfo = createChunkInfo(
            chunkIndex: chunkIndex,
            totalDuration: totalDuration,
            chunkDuration: chunkDuration,
            overlapDuration: overlapDuration
        )
        
        if enableLogging {
            print("📦 Creating chunk \(chunkIndex + 1):")
            print("   Base time: \(String(format: "%.2f", chunkInfo.baseStartTime))s - \(String(format: "%.2f", chunkInfo.baseEndTime))s")
            print("   With overlap: \(String(format: "%.2f", chunkInfo.actualStartTime))s - \(String(format: "%.2f", chunkInfo.actualEndTime))s")
        }
        
        if let chunkURL = await createChunk(
            sourceURL: sourceURL,
            startTime: chunkInfo.actualStartTime,
            endTime: chunkInfo.actualEndTime,
            chunkIndex: chunkIndex,
            enableLogging: enableLogging
        ) {
            return ChunkInfo(
                chunkIndex: chunkInfo.chunkIndex,
                url: chunkURL,
                actualStartTime: chunkInfo.actualStartTime,
                actualEndTime: chunkInfo.actualEndTime,
                baseStartTime: chunkInfo.baseStartTime,
                baseEndTime: chunkInfo.baseEndTime
            )
        }
        
        return nil
    }
    
    /// Creates all chunks at once for batch processing
    func createAllChunks(url: URL) async -> [ChunkInfo] {
        let asset = AVURLAsset(url: url)
        
        do {
            let duration = try await asset.load(.duration)
            let totalSeconds = CMTimeGetSeconds(duration)
            let calculatedChunks = Int(ceil(totalSeconds / chunkDuration))
            
            await MainActor.run {
                self.totalChunks = calculatedChunks
            }
            
            print("📊 Audio duration: \(String(format: "%.2f", totalSeconds)) seconds")
            print("📊 Chunk duration: \(chunkDuration) seconds")
            print("📊 Overlap duration: \(overlapDuration) seconds")
            print("📊 Total chunks to process: \(calculatedChunks)")
            print("📦 BATCH MODE: Creating all \(calculatedChunks) chunks first...")
            
            return await processChunksBatch(
                url: url,
                totalDuration: totalSeconds,
                totalChunks: calculatedChunks
            )
            
        } catch {
            print("Error getting audio duration: \(error)")
            return []
        }
    }
    
    // MARK: - Legacy method (for backward compatibility)
    
    func breakAudioIntoChunks(url: URL, chunkingStrategy: ChunkingStrategySpeech) async -> [ChunkInfo] {
        // This method now just calls the appropriate new method
        switch chunkingStrategy {
        case .sequential:
            // For backward compatibility, return empty array as sequential should use createSingleChunk
            print("⚠️ Warning: breakAudioIntoChunks called with sequential strategy. Use createSingleChunk instead.")
            return []
        case .batch:
            return await createAllChunks(url: url)
        }
    }
    
    // MARK: - Private helper methods
    
    private func processChunksBatch(url: URL, totalDuration: Double, totalChunks: Int) async -> [ChunkInfo] {
        var chunkInfos: [ChunkInfo] = []
        
        for chunkIndex in 0..<totalChunks {
            await MainActor.run {
                self.currentChunk = chunkIndex + 1
            }
            
            let chunkInfo = createChunkInfo(
                chunkIndex: chunkIndex,
                totalDuration: totalDuration,
                chunkDuration: chunkDuration,
                overlapDuration: overlapDuration
            )
            
            print("📦 Creating chunk \(chunkIndex + 1)/\(totalChunks):")
            print("   Base time: \(String(format: "%.2f", chunkInfo.baseStartTime))s - \(String(format: "%.2f", chunkInfo.baseEndTime))s")
            print("   With overlap: \(String(format: "%.2f", chunkInfo.actualStartTime))s - \(String(format: "%.2f", chunkInfo.actualEndTime))s")
            
            if let chunkURL = await createChunk(
                sourceURL: url,
                startTime: chunkInfo.actualStartTime,
                endTime: chunkInfo.actualEndTime,
                chunkIndex: chunkIndex
            ) {
                let finalChunkInfo = ChunkInfo(
                    chunkIndex: chunkInfo.chunkIndex,
                    url: chunkURL,
                    actualStartTime: chunkInfo.actualStartTime,
                    actualEndTime: chunkInfo.actualEndTime,
                    baseStartTime: chunkInfo.baseStartTime,
                    baseEndTime: chunkInfo.baseEndTime
                )
                chunkInfos.append(finalChunkInfo)
            }
        }
        
        print("📦 Created \(chunkInfos.count) chunks.")
        return chunkInfos
    }
    
    private func createChunkInfo(
        chunkIndex: Int,
        totalDuration: Double,
        chunkDuration: Double,
        overlapDuration: Double
    ) -> ChunkInfo {
        // Calculate base chunk times
        let baseStartTime = Double(chunkIndex) * chunkDuration
        let baseEndTime = min(baseStartTime + chunkDuration, totalDuration)
        
        // Add overlap: 2 seconds before and after (except for first/last chunks)
        let actualStartTime = max(0, baseStartTime - overlapDuration)
        let actualEndTime = min(totalDuration, baseStartTime + chunkDuration + overlapDuration)
        
        return ChunkInfo(
            chunkIndex: chunkIndex,
            url: nil, // Will be set after chunk creation
            actualStartTime: actualStartTime,
            actualEndTime: actualEndTime,
            baseStartTime: baseStartTime,
            baseEndTime: baseEndTime
        )
    }
    
    private func createChunk(sourceURL: URL, startTime: Double, endTime: Double, chunkIndex: Int, enableLogging: Bool = true) async -> URL? {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let chunkURL = documentsPath.appendingPathComponent("chunk_\(chunkIndex).m4a")
        
        // Remove existing chunk file if it exists
        if FileManager.default.fileExists(atPath: chunkURL.path) {
            try? FileManager.default.removeItem(at: chunkURL)
        }
        
        let asset = AVURLAsset(url: sourceURL)
        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            if enableLogging {
                print("❌ Could not create export session for chunk \(chunkIndex)")
            }
            return nil
        }
        
        // Set time range for this chunk (with overlap)
        let cmStartTime = CMTime(seconds: startTime, preferredTimescale: 1)
        let cmEndTime = CMTime(seconds: endTime, preferredTimescale: 1)
        let timeRange = CMTimeRange(start: cmStartTime, end: cmEndTime)
        
        exportSession.outputURL = chunkURL
        exportSession.outputFileType = .m4a
        exportSession.timeRange = timeRange
        
        do {
            try await exportSession.export(to: chunkURL, as: .m4a)
            if enableLogging {
                print("✅ Chunk \(chunkIndex + 1) created successfully (duration: \(String(format: "%.2f", endTime - startTime))s)")
            }
            return chunkURL
        } catch {
            if enableLogging {
                print("❌ Chunk \(chunkIndex + 1) creation failed: \(error.localizedDescription)")
            }
            return nil
        }
    }
    
    func cleanupChunkFiles(enableLogging: Bool = true) {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        
        do {
            let fileURLs = try FileManager.default.contentsOfDirectory(
                at: documentsPath,
                includingPropertiesForKeys: nil,
                options: .skipsHiddenFiles
            )
            
            // Remove all chunk files
            let chunkFiles = fileURLs.filter { $0.lastPathComponent.hasPrefix("chunk_") && $0.pathExtension == "m4a" }
            
            for fileURL in chunkFiles {
                try FileManager.default.removeItem(at: fileURL)
                if enableLogging {
                    print("🗑️ Removed chunk file: \(fileURL.lastPathComponent)")
                }
            }
            
            if !chunkFiles.isEmpty && enableLogging {
                print("🧹 Cleaned up \(chunkFiles.count) chunk files")
            }
            
        } catch {
            if enableLogging {
                print("❌ Error cleaning up chunk files: \(error.localizedDescription)")
            }
        }
    }
} 
