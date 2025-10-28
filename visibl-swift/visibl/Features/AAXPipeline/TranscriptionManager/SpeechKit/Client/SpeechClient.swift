//
//  SpeechClient.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import Speech

final class SpeechClient: ObservableObject {
    private var recognizer: SFSpeechRecognizer?
    private var speechConfig: SpeechClientConfiguration?
    private var currentRecognitionTask: SFSpeechRecognitionTask?
    private var isStoppingTranscription = false
    
    // Logging configuration
    var enableLogging: Bool = true
    
    @Published var isTranscribing = false
    @Published var currentChunk = 0
    @Published var totalChunks = 0
    @Published var fullTranscript = ""
    @Published var byWordsTranscript: [String] = []
    @Published var totalTranscriptionTime = 0.0
    @Published var overallStartTime = Date()
    
    // Published properties for UI
    @Published var isRecognizerReady = false
    @Published var currentLocale: Locale = Locale(identifier: "en-US")
    @Published var supportsOnDevice = false
    
    func setupSpeech(
        locale: Locale = Locale(identifier: "en-US"),
        addsPunctuation: Bool = true,
        taskHint: SFSpeechRecognitionTaskHint = .unspecified,
        contextualStrings: [String] = [],
        requiresOnDeviceRecognition: Bool = false
    ) {
        // Check authorization first
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            print("⚠️ Speech recognition not authorized. Requesting authorization...")
            authorizationRequest()
            return
        }
        
        // Create recognizer with specified locale
        guard let newRecognizer = SFSpeechRecognizer(locale: locale) else {
            print("❌ Could not create speech recognizer for locale: \(locale.identifier)")
            isRecognizerReady = false
            return
        }
        
        // Check availability
        guard newRecognizer.isAvailable else {
            print("❌ Speech recognizer is not available")
            isRecognizerReady = false
            return
        }
        
        // Update recognizer
        self.recognizer = newRecognizer
        self.currentLocale = locale
        self.supportsOnDevice = newRecognizer.supportsOnDeviceRecognition
        
        // Check on-device recognition support
        if requiresOnDeviceRecognition && !newRecognizer.supportsOnDeviceRecognition {
            print("⚠️ On-device recognition requested but not supported for locale: \(locale.identifier)")
            print("   Falling back to network-based recognition")
        }
        
        // Store configuration for later use
        self.speechConfig = SpeechClientConfiguration(
            locale: locale,
            addsPunctuation: addsPunctuation,
            taskHint: taskHint,
            contextualStrings: contextualStrings,
            requiresOnDeviceRecognition: requiresOnDeviceRecognition && newRecognizer.supportsOnDeviceRecognition
        )
        
        // Print configuration summary
        print("\n🎤 Speech Recognition Configuration:")
        print("   Locale: \(locale.identifier)")
        print("   Add punctuation: \(addsPunctuation)")
        print("   Task hint: \(taskHintDescription(taskHint))")
        print("   On-device recognition: \(speechConfig!.requiresOnDeviceRecognition)")
        if !contextualStrings.isEmpty {
            print("   Contextual strings: \(contextualStrings.joined(separator: ", "))")
        }
        
        // Mark recognizer as ready
        isRecognizerReady = true
    }
}

extension SpeechClient {
    public func transcribeChunks(_ chunks: [ChunkInfo], strategy: ChunkingStrategySpeech) async -> TranscriptionResultSpeech {
        // Check if recognizer is configured
        guard recognizer != nil, isRecognizerReady else {
            print("❌ Speech recognizer not configured. Please call setupSpeech() first.")
            return TranscriptionResultSpeech(
                fullTranscript: "",
                byWordsTranscript: [],
                totalTranscriptionTime: 0.0,
                totalProcessingTime: 0.0,
                chunksProcessed: 0
            )
        }
        
        // Use the new strategy-specific methods
        switch strategy {
        case .sequential:
            print("⚠️ Legacy transcribeChunks called with sequential strategy. Consider using the new coordinator flow.")
            // Initialize
            await initializeTranscription(totalChunks: chunks.count)
            
            // Process sequentially with immediate cleanup
            for (index, chunk) in chunks.enumerated() {
                guard !isStoppingTranscription && isTranscribing else {
                    print("⏹️ Stopping chunk processing at chunk \(index + 1)")
                    break
                }
                
                await MainActor.run {
                    self.currentChunk = index + 1
                }
                
                print("🎤 Processing chunk \(index + 1)/\(chunks.count)")
                await transcribeSingleChunk(chunk)
                
                // Clean up immediately for sequential mode
                try? FileManager.default.removeItem(at: chunk.url!)
            }
            
            return await finalizeTranscription()
            
        case .batch:
            return await transcribeAllChunks(chunks)
        }
    }
    
    func transcribeChunk(
        url: URL,
        chunkIndex: Int,
        startTimeOffset: Double,
        actualStartTime: Double,
        baseStartTime: Double,
        baseEndTime: Double
    ) async {
        guard let recognizer = self.recognizer,
              let config = self.speechConfig else {
            print("❌ Speech recognizer or configuration not available")
            return
        }
        
        // Check if we should stop
        guard !isStoppingTranscription else {
            print("⏹️ Skipping chunk \(chunkIndex) - transcription is being stopped")
            return
        }
        
        return await withCheckedContinuation { continuation in
            // Flag to ensure continuation is only resumed once
            var hasResumed = false
            
            // Helper function to safely resume continuation
            func safeResume() {
                guard !hasResumed else { return }
                hasResumed = true
                continuation.resume()
            }
            
            // No need to check authorization again, already done in setup
            guard recognizer.isAvailable else {
                print("Speech recognizer not available for chunk \(chunkIndex)")
                safeResume()
                return
            }
            
            let request = SFSpeechURLRecognitionRequest(url: url)
            
            // Apply configuration settings - make more aggressive for audiobooks
            request.shouldReportPartialResults = true  // Enable partial results to catch more speech
            request.requiresOnDeviceRecognition = false  // Use network-based for better accuracy
            
            // Apply additional settings if available
            if #available(iOS 16, *) {
                request.addsPunctuation = config.addsPunctuation
            }
            request.taskHint = .dictation  // Use dictation hint for better audiobook recognition
            request.contextualStrings = config.contextualStrings
            
            let transcriptionStart = Date()
            
            // Store the recognition task so we can cancel it if needed
            self.currentRecognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                // Always clear the task reference first
                self?.currentRecognitionTask = nil
                
                if let error = error {
                    // Check if error is due to cancellation
                    if (error as NSError).code == 203 { // kAFAssistantErrorDomain error 203 is cancellation
                        if self?.enableLogging == true {
                            print("⏹️ Recognition cancelled for chunk \(chunkIndex)")
                        }
                    } else {
                        if self?.enableLogging == true {
                            print("❌ Recognition error for chunk \(chunkIndex): \(error)")
                        }
                    }
                    safeResume()
                    return
                }
                
                guard let result = result, result.isFinal else { return }
                
                let transcriptionTime = Date().timeIntervalSince(transcriptionStart)
                let segments = result.bestTranscription.segments
                
                if self?.enableLogging == true {
                    print("✅ Chunk \(chunkIndex + 1) transcribed in \(String(format: "%.2f", transcriptionTime))s")
                    print("📝 Segments: \(segments.count)")
                }
                
                // Add to total transcription time
                Task { @MainActor in
                    self?.totalTranscriptionTime += transcriptionTime
                }
                
                // Print ALL segments with adjusted timestamps - no filtering
                for segment in segments {
                    let adjustedStartTime = segment.timestamp + startTimeOffset
                    let adjustedEndTime = adjustedStartTime + segment.duration
                    let value = "[\(String(format: "%.2f", adjustedStartTime))s - \(String(format: "%.2f", adjustedEndTime))s]: \(segment.substring)"
                    if self?.enableLogging == true {
                        print(value)
                    }
                    
                    Task { @MainActor in
                        self?.byWordsTranscript.append(value)
                    }
                }
                
                // Add ALL words to full transcript - no filtering
                let chunkTranscript = segments.map { $0.substring }.joined(separator: " ")
                if !chunkTranscript.isEmpty {
                    Task { @MainActor in
                        if !(self?.fullTranscript.isEmpty ?? true) {
                            self?.fullTranscript += " "
                        }
                        self?.fullTranscript += chunkTranscript
                    }
                }
                
                safeResume()
            }
        }
    }
    
    // MARK: - Control Methods
    
    /// Stops transcription gracefully
    func stopTranscription() {
        guard isTranscribing else { return }
        
        // Set flags to stop processing more chunks
        isTranscribing = false
        isStoppingTranscription = true
        
        // Cancel current recognition task
        currentRecognitionTask?.cancel()
        currentRecognitionTask = nil
        
        print("⏹️ Transcription stopped by user")
    }
    
    /// Resets all transcription data
    func reset() {
        // Set stopping flag
        isStoppingTranscription = true
        
        // Cancel any ongoing recognition task
        currentRecognitionTask?.cancel()
        currentRecognitionTask = nil
        
        // Reset all published properties
        isTranscribing = false
        currentChunk = 0
        totalChunks = 0
        fullTranscript = ""
        byWordsTranscript = []
        totalTranscriptionTime = 0.0
        overallStartTime = Date()
        isStoppingTranscription = false
        
        print("🔄 Reset completed - all data cleared")
    }
}

// MARK: - Helper Methods

extension SpeechClient {
    public func authorizationRequest() {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            DispatchQueue.main.async {
                switch authStatus {
                case .authorized:
                    print("✅ Speech recognition authorized")
                case .denied:
                    print("❌ Speech recognition denied")
                case .restricted:
                    print("⚠️ Speech recognition restricted")
                case .notDetermined:
                    print("❓ Speech recognition not determined")
                @unknown default:
                    print("❓ Unknown authorization status")
                }
            }
        }
    }
    
    func getSupportedLocales() {
        let supportedLocales = SFSpeechRecognizer.supportedLocales()
        
        print("📍 Supported locales (\(supportedLocales.count) total):")
        
        // Group by language for better readability
        var localesByLanguage: [String: [Locale]] = [:]
        
        for locale in supportedLocales {
            let languageCode = locale.language.languageCode?.identifier ?? "Unknown"
            if localesByLanguage[languageCode] == nil {
                localesByLanguage[languageCode] = []
            }
            localesByLanguage[languageCode]?.append(locale)
        }
        
        // Print sorted by language
        for (language, locales) in localesByLanguage.sorted(by: { $0.key < $1.key }) {
            print("\n\(language):")
            for locale in locales.sorted(by: { $0.identifier < $1.identifier }) {
                _ = locale.region?.identifier ?? ""
                let displayName = locale.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
                print("  - \(locale.identifier) (\(displayName))")
                
                // Check if on-device recognition is available
                if let recognizer = SFSpeechRecognizer(locale: locale) {
                    if recognizer.supportsOnDeviceRecognition {
                        print("    ✅ On-device recognition supported")
                    }
                }
            }
        }
    }
}

private extension SpeechClient {
    private func taskHintDescription(_ hint: SFSpeechRecognitionTaskHint) -> String {
        switch hint {
        case .unspecified:
            return "Unspecified"
        case .dictation:
            return "Dictation"
        case .search:
            return "Search"
        case .confirmation:
            return "Confirmation"
        @unknown default:
            return "Unknown"
        }
    }
}

extension SpeechClient {
    // MARK: - New Strategy-specific methods
    
    /// Initialize transcription for sequential processing
    func initializeTranscription(totalChunks: Int) async {
        await MainActor.run {
            self.fullTranscript = ""
            self.byWordsTranscript = []
            self.totalTranscriptionTime = 0.0
            self.overallStartTime = Date()
            self.isTranscribing = true
            self.isStoppingTranscription = false
            self.totalChunks = totalChunks
            self.currentChunk = 0
        }
    }
    
    /// Transcribe a single chunk for sequential processing
    func transcribeSingleChunk(_ chunkInfo: ChunkInfo) async {
        await transcribeChunk(
            url: chunkInfo.url!,
            chunkIndex: chunkInfo.chunkIndex,
            startTimeOffset: chunkInfo.actualStartTime,
            actualStartTime: chunkInfo.actualStartTime,
            baseStartTime: chunkInfo.baseStartTime,
            baseEndTime: chunkInfo.baseEndTime
        )
    }
    
    /// Finalize sequential transcription and return results
    func finalizeTranscription() async -> TranscriptionResultSpeech {
        let overallEndTime = Date()
        let totalProcessingTime = overallEndTime.timeIntervalSince(self.overallStartTime)
        
        let finalTranscript = await MainActor.run { return self.fullTranscript }
        let finalByWordsTranscript = await MainActor.run { return self.byWordsTranscript }
        let finalTotalTranscriptionTime = await MainActor.run { return self.totalTranscriptionTime }
        let finalTotalChunks = await MainActor.run { return self.totalChunks }
        
        await MainActor.run {
            self.isTranscribing = false
            self.isStoppingTranscription = false
        }
        
        return TranscriptionResultSpeech(
            fullTranscript: finalTranscript,
            byWordsTranscript: finalByWordsTranscript,
            totalTranscriptionTime: finalTotalTranscriptionTime,
            totalProcessingTime: totalProcessingTime,
            chunksProcessed: finalTotalChunks
        )
    }
    
    /// Transcribe all chunks for batch processing
    func transcribeAllChunks(_ chunks: [ChunkInfo]) async -> TranscriptionResultSpeech {
        // Initialize
        await initializeTranscription(totalChunks: chunks.count)
        
        // Reset chunk counter for transcription phase
        await MainActor.run {
            self.currentChunk = 0
        }
        
        var chunksProcessed = 0
        
        // Process all chunks
        for (index, chunk) in chunks.enumerated() {
            // Check if we should stop
            guard !isStoppingTranscription && isTranscribing else {
                print("⏹️ Stopping transcription at chunk \(index + 1)")
                break
            }
            
            await MainActor.run {
                self.currentChunk = index + 1
            }
            
            print("🎤 Transcribing chunk \(index + 1)/\(chunks.count)")
            
            await transcribeSingleChunk(chunk)
            chunksProcessed += 1
        }
        
        // Clean up all chunk files after transcription (for batch mode)
        print("🧹 Cleaning up \(chunks.count) chunk files...")
        for chunk in chunks {
            try? FileManager.default.removeItem(at: chunk.url!)
        }
        
        return await finalizeTranscription()
    }
}
