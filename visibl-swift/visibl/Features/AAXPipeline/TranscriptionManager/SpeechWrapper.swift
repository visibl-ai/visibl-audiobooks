//
//  SpeechWrapper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Speech

enum TranscriptionError: Error {
    case cancelled
    case coordinatorError(Error)
}

@MainActor
final class SpeechWrapper: ObservableObject {
    static let shared = SpeechWrapper()
    
    private let coordinator = SpeechCoordinator()
    
    @Published var isTranscribing = false
    @Published var currentChunk = 0
    @Published var totalChunks = 0
    @Published var fullTranscript = ""
    @Published var byWordsTranscript: [String] = []
    @Published var totalTranscriptionTime = 0.0
    @Published var overallStartTime = Date()
    
    @Published var isRecognizerReady = false
    @Published var currentLocale: Locale = Locale(identifier: "en-US")
    @Published var supportsOnDevice = false
    
    @Published var chunkingStrategy: ChunkingStrategySpeech = .sequential
    @Published var processingPhase: ProcessingPhaseSpeech = .idle
    
    // Store continuation and completion status
    private var activeContinuation: (id: UUID, continuation: CheckedContinuation<TranscriptionResultSpeech, Error>)?
    
    init() {
        bindCoordinatorProperties()
    }
    
    private func bindCoordinatorProperties() {
        coordinator.$isTranscribing
            .assign(to: &$isTranscribing)
        coordinator.$currentChunk
            .assign(to: &$currentChunk)
        coordinator.$totalChunks
            .assign(to: &$totalChunks)
        coordinator.$fullTranscript
            .assign(to: &$fullTranscript)
        coordinator.$byWordsTranscript
            .assign(to: &$byWordsTranscript)
        coordinator.$totalTranscriptionTime
            .assign(to: &$totalTranscriptionTime)
        coordinator.$overallStartTime
            .assign(to: &$overallStartTime)
        coordinator.$isRecognizerReady
            .assign(to: &$isRecognizerReady)
        coordinator.$currentLocale
            .assign(to: &$currentLocale)
        coordinator.$supportsOnDevice
            .assign(to: &$supportsOnDevice)
        
        $chunkingStrategy
            .assign(to: &coordinator.$chunkingStrategy)
        
        coordinator.$processingPhase
            .assign(to: &$processingPhase)
    }
    
    func setupSpeech(
        locale: Locale = Locale(identifier: "en-US"),
        addsPunctuation: Bool = true,
        taskHint: SFSpeechRecognitionTaskHint = .unspecified,
        contextualStrings: [String] = [],
        requiresOnDeviceRecognition: Bool = false
    ) {
        coordinator.setupSpeech(
            locale: locale,
            addsPunctuation: addsPunctuation,
            taskHint: taskHint,
            contextualStrings: contextualStrings,
            requiresOnDeviceRecognition: requiresOnDeviceRecognition
        )
    }
    
    func transcribeFile(url: URL) async throws -> TranscriptionResultSpeech {
        // Ensure coordinator is in a clean state before starting
        coordinator.reset()
        
        let continuationId = UUID()
        
        return try await withCheckedThrowingContinuation { continuation in
            // Store the continuation
            self.activeContinuation = (id: continuationId, continuation: continuation)
            
            coordinator.startChunkedTranscription(
                sourceURL: url,
                onProgress: { currentChunk, totalChunks in
                    Task { @MainActor in
                        // Only update progress if this is still the active continuation
                        guard let (storedId, _) = self.activeContinuation,
                              storedId == continuationId else { return }
                        print("Transcription progress: \(currentChunk)/\(totalChunks)")
                    }
                },
                onPhaseChange: { phase in
                    Task { @MainActor in
                        // Only update phase if this is still the active continuation
                        guard let (storedId, _) = self.activeContinuation,
                              storedId == continuationId else { return }
                        print("Phase changed to: \(phase)")
                    }
                },
                completion: { result in
                    Task { @MainActor in
                        // Only process completion if this continuation is still active
                        guard let (storedId, _) = self.activeContinuation,
                              storedId == continuationId else {
                            print("⚠️ Ignoring stale completion for continuation \(continuationId)")
                            return
                        }
                        
                        // Convert SpeechTranscriptionError to general Error
                        let convertedResult: Result<TranscriptionResultSpeech, Error>
                        switch result {
                        case .success(let transcript):
                            convertedResult = .success(transcript)
                        case .failure(let speechError):
                            convertedResult = .failure(TranscriptionError.coordinatorError(speechError))
                        }
                        self.resumeContinuation(continuationId, with: convertedResult)
                    }
                }
            )
        }
    }
    
    @MainActor
    private func resumeContinuation(_ expectedId: UUID, with result: Result<TranscriptionResultSpeech, Error>) {
        guard let (storedId, continuation) = activeContinuation,
              storedId == expectedId else {
            print("⚠️ Continuation \(expectedId) already resumed or cancelled")
            return
        }
        
        // Clear the stored continuation first
        activeContinuation = nil
        
        switch result {
        case .success(let transcript):
            print("✅ Transcription completed successfully")
            continuation.resume(returning: transcript)
            
        case .failure(let error):
            print("❌ Transcription failed with error: \(error)")
            continuation.resume(throwing: error)
        }
    }
    
    @MainActor
    func cancelTranscription() {
        print("🛑 Cancelling transcription...")
        
        // Clear the active continuation FIRST to prevent coordinator from resuming it
        if let (continuationId, continuation) = activeContinuation {
            activeContinuation = nil
            print("🛑 Resuming continuation \(continuationId) with cancellation error")
            continuation.resume(throwing: TranscriptionError.cancelled)
        }
        
        // Then stop the coordinator (this will NOT call completion handler now)
        coordinator.stopTranscription()
        
        // Reset coordinator after a brief delay to ensure cleanup
        Task {
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            coordinator.reset()
            print("🛑 Coordinator stopped and reset")
        }
    }
}
