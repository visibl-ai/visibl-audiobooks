//
//  TranscriptionManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation
import FirebaseAuth
import Combine

@MainActor
final class TranscriptionManager: ObservableObject {
    static let shared = TranscriptionManager()
    
    @Published var taskGroups: [TaskGroupModelSTT] = []
    @Published var currentTaskGroup: TaskGroupModelSTT?
    
    private let speech = SpeechWrapper.shared
    private var isProcessing = false
    private var progressTimer: Timer?
    
    // Store chapter metadata and items for trimming
    private var chapterMetadataCache: [String: [AVTimedMetadataGroup]] = [:]
    private var itemCache: [String: UserLibraryItemModel] = [:]
    
    @Published private var currentChunk = 0
    @Published private var totalChunks = 0
    
    private var cancellables = Set<AnyCancellable>()
    
    private init() {
        // speech.setupSpeech()
        bind()
    }
    
    private func bind() {
        speech.$currentChunk
            .assign(to: \.currentChunk, on: self)
            .store(in: &cancellables)
        
        speech.$totalChunks
            .assign(to: \.totalChunks, on: self)
            .store(in: &cancellables)
    }
    
    func progressString(for audiobookId: String) -> String {
       guard currentTaskGroup?.id == audiobookId,
             totalChunks > 0 else { return "" }
       
       let percentage = (Double(currentChunk) / Double(totalChunks)) * 100
       return String(format: "(%.0f%%)", percentage)
    }
    
    func getTranscriptionProgress(for audiobookId: String) -> Double {
        guard currentTaskGroup?.id == audiobookId,
              totalChunks > 0 else { return 0.0 }
        
        return Double(currentChunk) / Double(totalChunks)
    }
    
    func isTranscriptionActive(for audiobookId: String) -> Bool {
        return currentTaskGroup?.id == audiobookId && isProcessing
    }
}

// MARK: - Main Functions
extension TranscriptionManager {
    func startTranscription(for item: UserLibraryItemModel) async throws {
        guard !isTranscribing(item.id) else { return }
        
        if !speech.isRecognizerReady {
            speech.setupSpeech()
        }
        
        // Store the item
        itemCache[item.id] = item
        
        // Create task group immediately with preparing status
        let group = TaskGroupModelSTT(
            status: .preparing,
            tasks: [],
            userLibraryItem: item
        )
        
        taskGroups.append(group)
        
        // Prepare tasks asynchronously
        Task {
            
            do {
                let tasks = try await createTasks(for: item)
                
                // Check if group still exists (might have been cancelled)
                guard taskGroups.contains(where: { $0.id == item.id }) else {
                    itemCache.removeValue(forKey: item.id)
                    return
                }
                
                if tasks.isEmpty {
                    // Remove group if no tasks to process
                    taskGroups.removeAll { $0.id == item.id }
                    itemCache.removeValue(forKey: item.id)
                    return
                }
                
                // Update group with tasks and set to waiting
                group.tasks = tasks
                group.status = .waiting
                
                // Start processing
                await processNextGroup()
                
            } catch {
                // Remove group on error
                taskGroups.removeAll { $0.id == item.id }
                itemCache.removeValue(forKey: item.id)
                throw error
            }
        }
    }
    
    func isTranscribing(_ bookId: String) -> Bool {
        taskGroups.contains { $0.id == bookId && $0.status != .completed }
    }
    
    func getTranscriptionTaskGroup(for bookId: String) -> TaskGroupModelSTT? {
        taskGroups.first { $0.id == bookId }
    }
}

// MARK: - Processing
extension TranscriptionManager {
    func processNextGroup() async {
        guard !isProcessing, let group = taskGroups.first(where: { $0.status == .waiting }) else { return }
        
        isProcessing = true
        currentTaskGroup = group
        group.status = .transcribing
        
        print("📋 Starting transcription for group: \(group.id)")
        
        for task in group.tasks {
            // Check if transcription was cancelled between tasks
            guard taskGroups.contains(where: { $0.id == group.id && $0.status == .transcribing }) else {
                print("🛑 Transcription cancelled, stopping task processing for group: \(group.id)")
                isProcessing = false
                return
            }
            
            await transcribeTask(task, groupId: group.id)
        }
        
        // Only mark as completed if we weren't cancelled
        if taskGroups.contains(where: { $0.id == group.id && $0.status == .transcribing }) {
            // Clean up cache for this audiobook
            chapterMetadataCache.removeValue(forKey: group.id)
            itemCache.removeValue(forKey: group.id)
            
            // Remove completed group
            taskGroups.removeAll { $0.id == group.id }
            print("✅ Completed and removed transcription group: \(group.id)")
        }
        
        if currentTaskGroup?.id == group.id {
            currentTaskGroup = nil
        }
        
        isProcessing = false
        
        // Continue processing next group if any
        await processNextGroup()
    }
    
    func transcribeTask(_ task: TaskModelSTT, groupId: String) async {
        task.isActive = true
        
        do {
            // Extract audio just before transcription
            let audioURL: URL
            if task.audioURL.lastPathComponent == "placeholder" {
                audioURL = try await extractChapterForSequentialStrategy(groupId: groupId, chapterIndex: task.index)
            } else {
                audioURL = task.audioURL
            }
            
            let result = try await speech.transcribeFile(url: audioURL)
            let transcript = result.byWordsTranscript.joined(separator: "\n")
            
            _ = try await TranscriptionService.submitTranscription(
                id: groupId,
                chapter: task.index,
                transcription: transcript
            )
            
            print("✅ Chapter \(task.index) completed successfully")
            
            // Clean up the extracted audio file immediately
            try? FileManager.default.removeItem(at: audioURL)
            print("🗑️ Cleaned up extracted audio for chapter \(task.index)")
            
        } catch TranscriptionError.cancelled {
            print("🛑 Chapter \(task.index) was cancelled")
            // Don't treat cancellation as an error - just exit gracefully
            
        } catch {
            print("❌ Chapter \(task.index) failed: \(error)")
        }
        
        task.isActive = false
        progressTimer?.invalidate()
    }
    
    func cancelTranscription(for item: UserLibraryItemModel) {
        print("🛑 Cancelling transcription for item: \(item.id)")
        
        // Since both classes are @MainActor, we can call directly
        speech.cancelTranscription()
        
        // Clean up timers
        progressTimer?.invalidate()
        progressTimer = nil
        
        // Check if we're cancelling the currently processing group
        let wasCancellingCurrentGroup = currentTaskGroup?.id == item.id
        
        // Clean up cache for this audiobook
        chapterMetadataCache.removeValue(forKey: item.id)
        itemCache.removeValue(forKey: item.id)
        
        // Remove task groups
        taskGroups.removeAll { $0.id == item.id }
        if currentTaskGroup?.id == item.id {
            currentTaskGroup = nil
        }
        
        // Reset processing state only if we cancelled the current group
        if wasCancellingCurrentGroup {
            isProcessing = false
            
            // Add a 3-second delay to ensure coordinator is fully reset and all background tasks are cleaned up
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
                await processNextGroup()
            }
        }
        
        print("🛑 Cleanup completed for item: \(item.id)")
    }
}

// MARK: - Helpers
private extension TranscriptionManager {
    func createTasks(for item: UserLibraryItemModel) async throws -> [TaskModelSTT] {
        let itemChapters = item.content?.chapters?.compactMap { $0 } ?? []
        
        print("itemChapters count: \(itemChapters.count)")
        print("Using sequential trimming")
        
        // Print chapter statuses
        for chapter in itemChapters {
            print(chapter.transcriptions.status.rawValue)
        }
        
        var tasks: [TaskModelSTT] = []
        
        // Store chapter metadata for later use, create placeholder tasks
        let chapters = try await M4AUtility.getChapterInfo(for: item.convertedAAXFileURL)
        chapterMetadataCache[item.id] = chapters
        
        for (index, chapter) in itemChapters.enumerated() {
            guard chapter.transcriptions.status == .waiting,
                  index < chapters.count else { continue }
            
            // Create placeholder URL - actual extraction happens during transcription
            let placeholderURL = URL(fileURLWithPath: "placeholder")
            
            tasks.append(TaskModelSTT(
                index: index,
                audioURL: placeholderURL
            ))
        }
        
        print("tasks count \(tasks.count)")
        
        return tasks
    }
    
    func extractChapterForSequentialStrategy(groupId: String, chapterIndex: Int) async throws -> URL {
        guard let chapters = chapterMetadataCache[groupId],
              chapterIndex < chapters.count else {
            throw TranscriptionError.coordinatorError(NSError(
                domain: "TranscriptionManager",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Chapter metadata not found for extraction"]
            ))
        }
        
        // Get the stored UserLibraryItemModel
        guard let item = itemCache[groupId] else {
            throw TranscriptionError.coordinatorError(NSError(
                domain: "TranscriptionManager",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "User library item not found in cache"]
            ))
        }
        
        print("🎵 Extracting chapter \(chapterIndex) just-in-time...")
        
        return try await ChapterTrimmer.shared.extractChapterAudio(
            from: item.convertedAAXFileURL,
            audiobookID: groupId,
            chapter: chapters[chapterIndex],
            chapterIndex: chapterIndex
        )
    }
}

// MARK: - Cancel All

// MARK: - Main Functions
extension TranscriptionManager {
    func cancelAllTranscriptions() {
        print("🛑 Cancelling all transcriptions")
        
        // Cancel speech recognition
        speech.cancelTranscription()
        
        // Clean up timers
        progressTimer?.invalidate()
        progressTimer = nil
        
        // Store if we're cancelling the current group
        let wasCancellingCurrentGroup = currentTaskGroup != nil
        
        // Clear all caches
        chapterMetadataCache.removeAll()
        itemCache.removeAll()
        
        // Clear all task groups
        taskGroups.removeAll()
        currentTaskGroup = nil
        
        // Reset processing state
        if wasCancellingCurrentGroup {
            isProcessing = false
        }
        
        print("🛑 All transcriptions cancelled")
    }
}
