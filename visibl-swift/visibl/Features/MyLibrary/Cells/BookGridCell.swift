//
//  BookGridCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher
import Combine

struct BookGridCell: View {
    var audiobook: AudiobookModel
    @ObservedObject var aaxPipeline: AAXPipeline
    let action: () -> Void
    
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
    var isGraphReady: Bool { audiobook.publication.graphAvailable ?? false }
    
    var body: some View {
        VStack(alignment: .center, spacing: 12) {
            bookCover
            titles
        }
        .frame(width: 170)
        .overlay(alignment: .topTrailing) {
            newLabel
        }
        .onTapGesture {
            HapticFeedback.shared.trigger(style: .soft)
            action()
        }
        .id("book-\(audiobook.id)-\(audiobook.publication.graphProgress?.progress ?? 0)")
    }
}

// MARK: - Book Cover

private extension BookGridCell {
    private var bookCover: some View {
        Color.gray
            .frame(height: 170)
            .frame(maxWidth: .infinity)
            .clipShape(.rect(cornerRadius: 6))
            .overlay {
                KFImage(URL(string: audiobook.coverURL))
                    .resizable()
                    .placeholder { bookCoverPlaceholderView }
                    .fade(duration: 0.4)
                    .aspectRatio(contentMode: .fill)
            }
            .clipShape(.rect(cornerRadius: 6))
            .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
            .opacity(isGraphReady && isAAXready ? 1.0 : 0.16)
            .overlay(alignment: .bottomLeading) {
                if audiobook.isPlayable {
                    transcriptionProgressMinimizedView
                }
            }
            .overlay(alignment: .topLeading) {
                processingLabel
            }
            .overlay(alignment: .bottomLeading) {
                if let graphProgress = audiobook.publication.graphProgress, downloadTask == nil {
                    CircularProgressView(progress: Double(graphProgress.progress) / 100.0)
                        .opacity(isGraphReady ? 0 : 1)
                }
            }
    }
}

// MARK: - Processing Label

private extension BookGridCell {
    @ViewBuilder var processingLabel: some View {
        if aaxPipeline.pendingAudiobookIds.contains(audiobook.id) {
            Text("my_books_pending_title".localized)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.customBlack)
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.thinMaterial)
                        .shadow(color: .black.opacity(0.15), radius: 4)
                )
                .padding(6)
        } else if let task = downloadTask, task.overallProgress > 0.0 {
            Text("my_books_downloading_title".localized)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.customBlack)
                .frame(height: 28)
                .padding(.horizontal, 12)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.thinMaterial)
                        .shadow(color: .black.opacity(0.15), radius: 4)
                )
                .padding(6)
        } else {
            if let graphProgress = audiobook.publication.graphProgress {
                Text(graphProgress.description?[userConfig.selectedLanguage.rawValue]?.capitalized ?? "processing_with_ai".localized)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.customBlack)
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(.thinMaterial)
                            .shadow(color: .black.opacity(0.15), radius: 4)
                    )
                    .padding(6)
                    .opacity(isGraphReady ? 0 : 1)
            }
        }
    }
}

// MARK: - Titles

private extension BookGridCell {
    private var titles: some View {
        VStack(alignment: .leading, spacing: 4) {
            downloadProgressView
            HStack (spacing: 4) {
                downloadedLabelView
                Text(audiobook.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
            }
            .opacity(isGraphReady && isAAXready ? 1.0 : 0.16)
            
            Text(audiobook.authors.joined(separator: ", "))
                .font(.system(size: 13, weight: .regular))
                .lineLimit(1)
                .opacity(isGraphReady && isAAXready ? 1.0 : 0.16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
        .padding(.bottom, 16)
    }
}

// MARK: - New Indicator

private extension BookGridCell {
    @ViewBuilder private var newLabel: some View {
        if audiobook.playbackInfo.totalProgress == 0 {
            Circle()
                .fill(Color.toastRed.gradient)
                .frame(width: 20, height: 20)
                .offset(x: 8, y: -8)
        }
    }
}

// MARK: - Placeholder

private extension BookGridCell {
    private var bookCoverPlaceholderView: some View {
        Rectangle()
            .fill(Color(UIColor.systemGray4))
            .aspectRatio(1, contentMode: .fit)
            .cornerRadius(8)
            .shimmerEffect()
    }
}

// MARK: - Downloading View

private extension BookGridCell {
    @ViewBuilder var downloadProgressView: some View {
        if let task = downloadTask, task.overallProgress > 0.0 {
            ProgressView(value: task.overallProgress, total: 1.0)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 4)
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

private extension BookGridCell {
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

private extension BookGridCell {
    @ViewBuilder var aaxGraphProcessing: some View {
        if let graphProgress = audiobook.publication.graphProgress {
            VStack {
                Text(graphProgress.description?[userConfig.selectedLanguage.rawValue]?.capitalized ?? "processing_with_ai".localized)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.customBlack)
                    .multilineTextAlignment(.center)
                Text(String(graphProgress.progress) + "%")
                    .font(.system(size: 32, weight: .heavy))
                    .foregroundStyle(.customBlack)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 6))
            .id("progress-\(audiobook.id)-\(graphProgress.progress)")
        }
    }
}

struct CircularProgressView: View {
    var progress: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(.white, lineWidth: 4)
            Circle()
                .trim(from: 0, to: CGFloat(self.progress))
                .stroke(
                    .customIndigo,
                    style: StrokeStyle(lineWidth: 4, lineCap: .round))
        }
        .rotationEffect(Angle(degrees: -90))
        .frame(width: 16, height: 16)
        .frame(width: 32, height: 32)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(.thinMaterial)
                .shadow(color: .black.opacity(0.15), radius: 4)
        )
        .padding(6)
    }
}
