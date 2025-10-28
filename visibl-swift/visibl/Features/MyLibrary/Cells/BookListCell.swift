//
//  BookListCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct BookListCell: View {
    var audiobook: AudiobookModel
    @ObservedObject var aaxPipeline: AAXPipeline
    let action: () -> Void
    let menuView: any View
    
    @ObservedObject private var transcriptionManager = TranscriptionManager.shared
    @ObservedObject private var userConfig = UserConfigurations.shared
    
    // MARK: - Downloading Related
    
    var isDownloaded: Bool { audiobook.isAAX && audiobook.isDownloaded }
    var downloadTask: AAXProcessingTaskModel? { aaxPipeline.tasks.first { $0.audiobookId == audiobook.id } }
    
    // MARK: - On Device Transcription Related
    
    var transcriptionTask: TaskGroupModelSTT? { transcriptionManager.taskGroups.first { $0.id == audiobook.id } }
    var isTranscribing: Bool { transcriptionTask != nil }
    var transcriptionProgress: String? { transcriptionManager.progressString(for: audiobook.id) }
    
    // MARK: - Graph Related
    
    var isAAXready: Bool { !audiobook.isAAX || audiobook.isDownloaded }
    var isGraphReady: Bool { audiobook.publication.graphProgress?.progress == 100 }
    
    init(
        audiobook: AudiobookModel,
        aaxPipeline: AAXPipeline,
        action: @escaping () -> Void,
        menuView: any View
    ) {
        self.audiobook = audiobook
        self.aaxPipeline = aaxPipeline
        self.action = action
        self.menuView = menuView
    }
    
    var body: some View {
        VStack {
            HStack(alignment: .center, spacing: 8) {
                bookCover
                titles
                AnyView(menuView)
            }
            .padding(.all, 12)
        }
        .background(.customGray6.opacity(isGraphReady && isAAXready ? 1.0 : 0.6))
        // .background(.customGray6.opacity(!isTranscribing || audiobook.isPlayable ? 1.0 : 0.6))
        .overlay(alignment: .topLeading) {
            newLabel
        }
        .onTapGesture {
            HapticFeedback.shared.trigger(style: .soft)
            action()
        }
    }
}

// MARK: - Book Cover

private extension BookListCell {
    private var bookCover: some View {
        KFImage(URL(string: audiobook.coverURL))
            .resizable()
            .placeholder {
                bookCoverPlaceholderView
            }
            .frame(width: 70, height: 70)
            .scaledToFill()
            .cornerRadius(8)
            .contentShape(Rectangle())
            .clipShape(Rectangle())
            .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
            // .opacity(!isTranscribing || audiobook.isPlayable ? 1.0 : 0.42)
            .opacity(isGraphReady && isAAXready ? 1.0 : 0.42)
    }
}

// MARK: - Titles

private extension BookListCell {
    private var titles: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let task = transcriptionTask {
                HStack (spacing: 4) {
                    Text(task.status.title)
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(.customWhite)
                    
                    HStack(spacing: 6) {
                        Text(audiobook.progressString)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.customWhite)
                        
                        Text(transcriptionManager.progressString(for: audiobook.id))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.customWhite)
                    }
                }
                .padding(.horizontal, 8)
                .frame(height: 20)
                .background(.customBlack, in: .rect(cornerRadius: 4))
            }
            
            HStack (spacing: 6) {
                if isDownloaded {
                    Image(systemName: "checkmark.icloud.fill")
                        .font(.system(size: 12))
                }
                
                Text(audiobook.title)
                    .font(.system(size: 15, weight: .medium))
                    .lineLimit(1)
            }
            .opacity(isGraphReady && isAAXready ? 1.0 : 0.42)
            //.opacity(!isTranscribing || audiobook.isPlayable ? 1.0 : 0.42)
            
            Text(audiobook.authors.joined(separator: ", "))
                .font(.system(size: 13, weight: .regular))
                .lineLimit(2)
                .opacity(isGraphReady && isAAXready ? 1.0 : 0.42)
                // .opacity(!isTranscribing || audiobook.isPlayable ? 1.0 : 0.42)
            
            if let task = downloadTask, task.overallProgress > 0.0 {
                HStack(spacing: 6) {
                    Text("\(Int(task.overallProgress * 100))%")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.customWhite)
                        .frame(width: 28, height: 20)
                        .background(.customBlack, in: .rect(cornerRadius: 4))
                    
                    Text("my_books_downloading_title".localized)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.customWhite)
                        .frame(height: 20)
                        .padding(.horizontal, 10)
                        .background(.customBlack, in: .rect(cornerRadius: 4))
                }
                .padding(.top, 3)
            }
            
            aaxGraphProcessing
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
    }
}

// MARK: - New Indicator

private extension BookListCell {
    @ViewBuilder private var newLabel: some View {
        if audiobook.playbackInfo.totalProgress == 0 && isGraphReady {
            Circle()
                .fill(Color.toastRed.gradient)
                .frame(width: 20, height: 20)
                .padding(5)
        }
    }
}

// MARK: - Placeholder

private extension BookListCell {
    private var bookCoverPlaceholderView: some View {
        Rectangle()
            .fill(Color(UIColor.systemGray4))
            .frame(maxWidth: .infinity)
            .frame(width: 80, height: 70)
            .cornerRadius(6)
            .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
            .shimmerEffect()
    }
}

// MARK: - Downloading View

private extension BookListCell {
    @ViewBuilder var downloadProgressView: some View {
        if let task = downloadTask, task.overallProgress > 0.0 {
            HStack {
                ProgressView(value: task.overallProgress, total: 1.0)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 4)
                
                Text("my_books_downloading_title".localized)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.customBlack)
                    .frame(height: 28)
                    .padding(.horizontal, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(.thinMaterial)
                            .shadow(radius: 4)
                    )
                    .padding(6)
            }
        }
    }
    
    @ViewBuilder var downloadedLabelView: some View {
        if isDownloaded {
            Image(systemName: "checkmark.icloud.fill")
                .font(.system(size: 10))
        }
    }
}

// MARK: - Transcription Processing View

private extension BookListCell {
    @ViewBuilder var transcriptionProgressView: some View {
        if let task = transcriptionTask, let progress = transcriptionProgress {
            VStack {
                Text(task.status.title)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(.customBlack)
                HStack(spacing: 6) {
                    Text(audiobook.progressString)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.customBlack)
                    Text(progress)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.customBlack)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 6))
        }
    }
    
    @ViewBuilder var transcriptionProgressMinimizedView: some View {
        if transcriptionTask != nil, let progress = transcriptionProgress {
            HStack(spacing: 4) {
                Image(systemName: "waveform.path")
                    .font(.system(size: 12))
                HStack(spacing: 4) {
                    Text(audiobook.progressString)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.customBlack)
                    Text(progress)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.customBlack)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 6))
            .padding(10)
        }
    }
}

// MARK: - Graph Processing View

private extension BookListCell {
    @ViewBuilder private var aaxGraphProcessing: some View {
        if let graphProgress = audiobook.publication.graphProgress, !isGraphReady {
            HStack (spacing: 5) {
                Text(String(graphProgress.progress) + "%")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.customBlack)
                Text(graphProgress.description?[userConfig.selectedLanguage.rawValue]?.capitalized ?? "processing_with_ai".localized)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.customBlack)
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.customGray5, in: .rect(cornerRadius: 6))
            .id("progress-\(audiobook.id)-\(graphProgress.progress)")
        }
    }
}

