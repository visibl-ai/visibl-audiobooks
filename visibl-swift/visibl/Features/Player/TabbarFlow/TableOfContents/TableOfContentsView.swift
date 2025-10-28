//
//  TableOfContentsView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct TableOfContentsView: View {
    @Environment(\.dismiss) var dismiss
    @ObservedObject var viewModel: PlayerViewModel

    var body: some View {
        VStack {
            title
            tableOfContents
        }
        .trackScreenView(
            "Table of Contents",
            properties: [
                "book_id": viewModel.audiobook.id,
                "book_title": viewModel.audiobook.title,
                "author": viewModel.audiobook.authors,
                "is_AAX": viewModel.audiobook.isAAX
            ]
        )
    }
    
    private var title: some View {
        Text("Table of Contents")
            .font(.system(size: 24, weight: .bold, design: .serif))
            .foregroundColor(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 52)
    }
    
    private var tableOfContents: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(Array(viewModel.audiobook.readingOrder.enumerated()), id: \.element.startTime) { index, item in
                    Button(action: {
                        if isChapterProcessing(index: index) {
                            Toastify.show(style: .warning, message: "chapter_processing_message".localized)
                        }
                        
                        guard isChapterReady(index: index) else {
                            return
                        }

                        HapticFeedback.shared.trigger(style: .light)
                        viewModel.pause()
                        viewModel.playAudio(at: index)
                        dismiss()

                        print("Selected chapter index #\(index)")
                    }) {
                        HStack {
                            Text(item.title ?? "Audiotrack #\(index + 1)")
                                .font(.system(size: 16, weight: isSelected(index: index) ? .semibold : .regular))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .foregroundStyle(.customBlack)

                            if isSelected(index: index) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.customIndigo)
                            } else if isChapterProcessing(index: index) {
                                ProgressView()
                                    .tint(.customBlack)
                            }
                        }
                    }
                    // .disabled(!isChapterReady(index: index))
                    .opacity(isChapterReady(index: index) ? 1.0 : isChapterProcessing(index: index) ? 0.6 : 0.3)
                    .id(index)
                }
            }
            .listStyle(.plain)
            .scrollIndicators(.hidden)
            .padding(.horizontal, 0)
            .onAppear {
                proxy.scrollTo(viewModel.audiobook.playbackInfo.currentResourceIndex, anchor: .center)
            }
        }
    }
    
    private func isSelected(index: Int) -> Bool {
        return index == viewModel.audiobook.playbackInfo.currentResourceIndex
    }

    private func isChapterReady(index: Int) -> Bool {
        guard let completedChapters = viewModel.audiobook.graphProgress?.completedChapters else {
            return true
        }
        return completedChapters.contains(index)
    }

    private func isChapterProcessing(index: Int) -> Bool {
        guard let processingChapters = viewModel.audiobook.graphProgress?.processingChapters else {
            return false
        }
        return processingChapters.contains(index)
    }
}
