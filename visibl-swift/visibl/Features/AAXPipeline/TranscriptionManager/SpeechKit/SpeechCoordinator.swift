//
//  SpeechCoordinator.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AVFoundation
import Speech
import Combine

// MARK: - Completion Handler Types

typealias TranscriptionProgressHandler = (Int, Int) -> Void // currentChunk, totalChunks
typealias TranscriptionCompletionHandler = (Result<TranscriptionResultSpeech, SpeechTranscriptionError>) -> Void
typealias TranscriptionPhaseChangeHandler = (ProcessingPhaseSpeech) -> Void

final class SpeechCoordinator: ObservableObject {
    // Dependencies
    private let audioTrimmer = AudioTrimmer()
    private let speechClient = SpeechClient()
    
    // Configuration
    public var configuration = TranscriptionConfiguration.default
    
    // Published properties from components
    @Published var isTranscribing = false
    @Published var currentChunk = 0
    @Published var totalChunks = 0
    @Published var fullTranscript = ""
    @Published var byWordsTranscript: [String] = []
    @Published var totalTranscriptionTime = 0.0
    @Published var overallStartTime = Date()
    
    // Speech configuration
    @Published var isRecognizerReady = false
    @Published var currentLocale: Locale = Locale(identifier: "en-US")
    @Published var supportsOnDevice = false
    @Published var chunkingStrategy: ChunkingStrategySpeech = .sequential
    @Published var processingPhase: ProcessingPhaseSpeech = .idle
    
    // Error handling
    @Published var lastError: SpeechTranscriptionError?
    
    // Cancellation support
    private var currentTask: Task<Void, Never>?
    
    // Completion handlers
    private var completionHandler: TranscriptionCompletionHandler?
    private var progressHandler: TranscriptionProgressHandler?
    private var phaseChangeHandler: TranscriptionPhaseChangeHandler?
    
    init() {
        // Bind properties from dependencies
        bindProperties()
        
        // Configure logging for dependencies
        updateDependencyLogging()
        
        // Set up phase change monitoring
        setupPhaseChangeMonitoring()
    }
    
    deinit {
        currentTask?.cancel()
    }
    
    private func bindProperties() {
        // Bind audio trimmer properties (but NOT currentChunk - we'll manage that manually)
        audioTrimmer.$totalChunks
            .assign(to: &$totalChunks)
        
        // Bind speech client properties
        speechClient.$isTranscribing
            .assign(to: &$isTranscribing)
        speechClient.$fullTranscript
            .assign(to: &$fullTranscript)
        speechClient.$byWordsTranscript
            .assign(to: &$byWordsTranscript)
        speechClient.$totalTranscriptionTime
            .assign(to: &$totalTranscriptionTime)
        speechClient.$overallStartTime
            .assign(to: &$overallStartTime)
        speechClient.$isRecognizerReady
            .assign(to: &$isRecognizerReady)
        speechClient.$currentLocale
            .assign(to: &$currentLocale)
        speechClient.$supportsOnDevice
            .assign(to: &$supportsOnDevice)
    }
    
    private func updateDependencyLogging() {
        speechClient.enableLogging = configuration.enableProgressLogging
    }
    
    private func setupPhaseChangeMonitoring() {
        $processingPhase
            .sink { [weak self] phase in
                self?.phaseChangeHandler?(phase)
            }
            .store(in: &cancellables)
        
        // Monitor progress changes
        $currentChunk
            .combineLatest($totalChunks)
            .sink { [weak self] currentChunk, totalChunks in
                guard totalChunks > 0 else { return }
                self?.progressHandler?(currentChunk, totalChunks)
            }
            .store(in: &cancellables)
    }
    
    private var cancellables = Set<AnyCancellable>()
}

// MARK: - Public Interface with Completion Handlers

extension SpeechCoordinator {
    
    // MARK: - Completion Handler Registration
    
    func setCompletionHandler(_ handler: @escaping TranscriptionCompletionHandler) {
        completionHandler = handler
    }
    
    func setProgressHandler(_ handler: @escaping TranscriptionProgressHandler) {
        progressHandler = handler
    }
    
    func setPhaseChangeHandler(_ handler: @escaping TranscriptionPhaseChangeHandler) {
        phaseChangeHandler = handler
    }
    
    // MARK: - Convenience method with inline completion
    
    func startChunkedTranscription(
        sourceURL: URL,
        onProgress: TranscriptionProgressHandler? = nil,
        onPhaseChange: TranscriptionPhaseChangeHandler? = nil,
        completion: @escaping TranscriptionCompletionHandler
    ) {
        // Store handlers
        self.completionHandler = completion
        self.progressHandler = onProgress
        self.phaseChangeHandler = onPhaseChange
        
        // Start transcription
        startChunkedTranscription(sourceURL: sourceURL)
    }
    
    // MARK: - Speech Setup
    
    func setupSpeech(
        locale: Locale = Locale(identifier: "en-US"),
        addsPunctuation: Bool = true,
        taskHint: SFSpeechRecognitionTaskHint = .unspecified,
        contextualStrings: [String] = [],
        requiresOnDeviceRecognition: Bool = false
    ) {
        speechClient.setupSpeech(
            locale: locale,
            addsPunctuation: addsPunctuation,
            taskHint: taskHint,
            contextualStrings: contextualStrings,
            requiresOnDeviceRecognition: requiresOnDeviceRecognition
        )
    }
    
    func authorizationRequest() {
        speechClient.authorizationRequest()
    }
    
    func getSupportedLocales() {
        speechClient.getSupportedLocales()
    }
    
    // MARK: - Main Transcription Flow
    
    func startChunkedTranscription(sourceURL: URL) {
        // Cancel any existing task
        currentTask?.cancel()
        
        // Create new task
        currentTask = Task { @MainActor in
            await performTranscription(sourceURL: sourceURL)
        }
    }
    
    @MainActor
    private func performTranscription(sourceURL: URL) async {
        var result: Result<TranscriptionResultSpeech, SpeechTranscriptionError>
        
        do {
            // Clear previous error
            lastError = nil
            
            // Validate setup
            try validateSetup()
            
            // Set initial state
            processingPhase = .creatingChunks
            currentChunk = 0
            
            let transcriptionResult = try await executeTranscriptionStrategy(sourceURL: sourceURL)
            
            // Set completion state
            processingPhase = .completed
            
            if configuration.enableProgressLogging {
                logTranscriptionCompletion(transcriptionResult)
            }
            
            result = .success(transcriptionResult)
            
        } catch is CancellationError {
            // Handle cancellation gracefully
            processingPhase = .idle
            if configuration.enableProgressLogging {
                print("⏹️ Transcription cancelled")
            }
            result = .failure(.transcriptionCancelled)
            
        } catch let error as SpeechTranscriptionError {
            lastError = error
            processingPhase = .idle
            if configuration.enableProgressLogging {
                print("❌ Transcription failed: \(error.localizedDescription)")
            }
            result = .failure(error)
            
        } catch {
            let speechError = SpeechTranscriptionError.audioProcessingFailed(error.localizedDescription)
            lastError = speechError
            processingPhase = .idle
            if configuration.enableProgressLogging {
                print("❌ Unexpected error: \(error)")
            }
            result = .failure(speechError)
        }
        
        // Call completion handler
        completionHandler?(result)
    }
    
    private func validateSetup() throws {
        guard isRecognizerReady else {
            throw SpeechTranscriptionError.recognizerNotConfigured
        }
    }
    
    private func executeTranscriptionStrategy(sourceURL: URL) async throws -> TranscriptionResultSpeech {
        if configuration.enableProgressLogging {
            print("🚀 Starting chunked transcription with strategy: \(chunkingStrategy)")
        }
        
        switch chunkingStrategy {
        case .sequential:
            return try await processSequentialTranscription(sourceURL: sourceURL)
        case .batch:
            return try await processBatchTranscription(sourceURL: sourceURL)
        }
    }
    
    private func logTranscriptionCompletion(_ result: TranscriptionResultSpeech) {
        print("🎉 Transcription completed:")
        print("   - Strategy: \(chunkingStrategy)")
        print("   - Chunks processed: \(result.chunksProcessed)")
        print("   - Total transcription time: \(String(format: "%.2f", result.totalTranscriptionTime))s")
        print("   - Total processing time: \(String(format: "%.2f", result.totalProcessingTime))s")
        print("   - Final transcript length: \(result.fullTranscript.count) characters")
    }
    
    // MARK: - Strategy-specific processing methods
    
    private func processSequentialTranscription(sourceURL: URL) async throws -> TranscriptionResultSpeech {
        if configuration.enableProgressLogging {
            print("🔄 SEQUENTIAL MODE: Create chunk → Transcribe → Clean up → Repeat")
        }
        
        let audioInfo = try await extractAudioInfo(from: sourceURL)
        let calculatedChunks = Int(ceil(audioInfo.duration / configuration.chunkDuration))
        
        await MainActor.run {
            self.totalChunks = calculatedChunks
            self.processingPhase = .transcribing
        }
        
        // Initialize speech client for transcription
        await speechClient.initializeTranscription(totalChunks: calculatedChunks)
        
        // Process each chunk sequentially
        for chunkIndex in 0..<calculatedChunks {
            try Task.checkCancellation()
            
            await MainActor.run {
                self.currentChunk = chunkIndex + 1
            }
            
            try await processSequentialChunk(
                sourceURL: sourceURL,
                chunkIndex: chunkIndex,
                totalDuration: audioInfo.duration
            )
        }
        
        return await speechClient.finalizeTranscription()
    }
    
    private func processBatchTranscription(sourceURL: URL) async throws -> TranscriptionResultSpeech {
        if configuration.enableProgressLogging {
            print("⚡ BATCH MODE: Create all chunks first → Then transcribe all")
        }
        
        // Phase 1: Creating all chunks
        await MainActor.run {
            self.processingPhase = .creatingChunks
            self.currentChunk = 0
        }
        
        let chunks = try await createAllChunksWithProgress(sourceURL: sourceURL)
        
        guard !chunks.isEmpty else {
            throw SpeechTranscriptionError.noChunksCreated
        }
        
        if configuration.enableProgressLogging {
            print("📦 Created \(chunks.count) chunks, starting transcription...")
        }
        
        // Phase 2: Transcribing all chunks
        await MainActor.run {
            self.processingPhase = .transcribing
            self.currentChunk = 0
        }
        
        return try await transcribeAllChunksWithProgress(chunks)
    }
    
    // MARK: - Helper methods
    
    private struct AudioInfo {
        let duration: Double
        let asset: AVURLAsset
    }
    
    private func extractAudioInfo(from url: URL) async throws -> AudioInfo {
        let asset = AVURLAsset(url: url)
        
        do {
            let duration = try await asset.load(.duration)
            let totalSeconds = CMTimeGetSeconds(duration)
            
            if configuration.enableProgressLogging {
                print("📊 Audio duration: \(String(format: "%.2f", totalSeconds)) seconds")
                print("📊 Chunk duration: \(configuration.chunkDuration) seconds")
                print("📊 Total chunks to process: \(Int(ceil(totalSeconds / configuration.chunkDuration)))")
            }
            
            return AudioInfo(duration: totalSeconds, asset: asset)
        } catch {
            throw SpeechTranscriptionError.audioProcessingFailed("Failed to load audio duration: \(error)")
        }
    }
    
    private func processSequentialChunk(sourceURL: URL, chunkIndex: Int, totalDuration: Double) async throws {
        // Check for cancellation first
        try Task.checkCancellation()
        
        if configuration.enableProgressLogging {
            print("📦 Creating and processing chunk \(chunkIndex + 1)")
        }
        
        guard let chunkInfo = await audioTrimmer.createSingleChunk(
            sourceURL: sourceURL,
            chunkIndex: chunkIndex,
            totalDuration: totalDuration,
            enableLogging: configuration.enableProgressLogging
        ) else {
            throw SpeechTranscriptionError.audioProcessingFailed("Failed to create chunk \(chunkIndex + 1)")
        }
        
        // Check for cancellation before transcription
        try Task.checkCancellation()
        
        await speechClient.transcribeSingleChunk(chunkInfo)
        
        // Clean up chunk file immediately
        try? FileManager.default.removeItem(at: chunkInfo.url!)
        
        if configuration.enableProgressLogging {
            print("🗑️ Cleaned up chunk \(chunkIndex + 1)")
        }
    }
    
    private func createAllChunksWithProgress(sourceURL: URL) async throws -> [ChunkInfo] {
        let audioInfo = try await extractAudioInfo(from: sourceURL)
        let calculatedChunks = Int(ceil(audioInfo.duration / configuration.chunkDuration))
        
        await MainActor.run {
            self.totalChunks = calculatedChunks
        }
        
        if configuration.enableProgressLogging {
            print("📦 BATCH MODE: Creating all \(calculatedChunks) chunks first...")
        }
        
        var chunkInfos: [ChunkInfo] = []
        
        // Create chunks with progress tracking
        for chunkIndex in 0..<calculatedChunks {
            try Task.checkCancellation()
            
            await MainActor.run {
                self.currentChunk = chunkIndex + 1
            }
            
            guard let chunkInfo = await audioTrimmer.createSingleChunk(
                sourceURL: sourceURL,
                chunkIndex: chunkIndex,
                totalDuration: audioInfo.duration,
                enableLogging: configuration.enableProgressLogging
            ) else {
                throw SpeechTranscriptionError.audioProcessingFailed("Failed to create chunk \(chunkIndex + 1)")
            }
            
            chunkInfos.append(chunkInfo)
        }
        
        if configuration.enableProgressLogging {
            print("📦 Created \(chunkInfos.count) chunks.")
        }
        
        return chunkInfos
    }
    
    private func transcribeAllChunksWithProgress(_ chunks: [ChunkInfo]) async throws -> TranscriptionResultSpeech {
        // Initialize speech client
        await speechClient.initializeTranscription(totalChunks: chunks.count)
        
        // Process all chunks with coordinator progress tracking
        for (index, chunk) in chunks.enumerated() {
            try Task.checkCancellation()
            
            // Check if we should stop using coordinator's public properties
            guard isTranscribing else {
                throw SpeechTranscriptionError.transcriptionCancelled
            }
            
            await MainActor.run {
                self.currentChunk = index + 1
            }
            
            if configuration.enableProgressLogging {
                print("🎤 Transcribing chunk \(index + 1)/\(chunks.count)")
            }
            
            await speechClient.transcribeSingleChunk(chunk)
        }
        
        // Clean up all chunk files after transcription (for batch mode)
        if configuration.enableProgressLogging {
            print("🧹 Cleaning up \(chunks.count) chunk files...")
        }
        
        for chunk in chunks {
            try? FileManager.default.removeItem(at: chunk.url!)
        }
        
        return await speechClient.finalizeTranscription()
    }
    
    // MARK: - Control Methods
    func stopTranscription() {
        // Cancel the current task first
        currentTask?.cancel()
        currentTask = nil
        
        // Stop speech client
        speechClient.stopTranscription()
        
        Task { @MainActor in
            processingPhase = .idle
            currentChunk = 0
        }
        
        if configuration.enableProgressLogging {
            print("⏹️ Transcription stopped by user")
        }
    }
    
    func reset() {
        // Cancel any ongoing tasks first
        currentTask?.cancel()
        currentTask = nil
        
        // Reset speech client and trimmer
        speechClient.reset()
        audioTrimmer.cleanupChunkFiles(enableLogging: configuration.enableProgressLogging)
        
        // Reset coordinator state
        processingPhase = .idle
        lastError = nil
        currentChunk = 0
        totalChunks = 0
        
        // Clear completion handlers
        completionHandler = nil
        progressHandler = nil
        phaseChangeHandler = nil
        
        if configuration.enableProgressLogging {
            print("🔄 Reset completed - all data cleared")
        }
    }
    
    // MARK: - Configuration
    
    func updateConfiguration(_ newConfiguration: TranscriptionConfiguration) {
        configuration = newConfiguration
        updateDependencyLogging()
    }
    
    func enableDebugLogging(_ enabled: Bool) {
        configuration = TranscriptionConfiguration(
            chunkDuration: configuration.chunkDuration,
            overlapDuration: configuration.overlapDuration,
            maxConcurrentChunks: configuration.maxConcurrentChunks,
            enableProgressLogging: enabled
        )
        updateDependencyLogging()
    }
}
