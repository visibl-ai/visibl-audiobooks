//
//  PlayerTimeSlider.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PlayerTimeSlider: View {
    @Binding var time: Double
    let duration: Double
    var nextAction: () -> Void
    var previousAction: () -> Void
    
    @State private var isEditing: Bool = false
    @State private var progress: Double
    
    var author: String
    var bookName: String
    
    let isNextEnabled: Bool
    let isPreviousEnabled: Bool
    
    @Binding var playbackSpeed: Double
    let onSpeedChange: (Double) -> Void
    
    init(
        author: String,
        bookName: String,
        time: Binding<Double>,
        duration: Double,
        isNextEnabled: Bool,
        isPreviousEnabled: Bool,
        playbackSpeed: Binding<Double>,
        onSpeedChange: @escaping (Double) -> Void,
        nextAction: @escaping () -> Void,
        previousAction: @escaping () -> Void
    ) {
        self.author = author
        self.bookName = bookName
        self._time = time
        self.duration = duration
        self.isNextEnabled = isNextEnabled
        self.isPreviousEnabled = isPreviousEnabled
        self._playbackSpeed = playbackSpeed
        self.onSpeedChange = onSpeedChange
        self.nextAction = nextAction
        self.previousAction = previousAction
        self._progress = State(initialValue: time.wrappedValue / duration)
    }
    
    var body: some View {
        VStack {
            VStack {
                HStack (spacing: 12) {
                    Button(action: {
                        guard isPreviousEnabled else { return }
                        let impactHeavy = UIImpactFeedbackGenerator(style: .medium)
                        impactHeavy.impactOccurred()
                        previousAction()
                    }) {
                        if #available(iOS 26.0, *) {
                            Image(systemName: "backward.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(isPreviousEnabled ? .customBlack : .customBlack.opacity(0.25))
                        } else {
                            Image(systemName: "backward.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(isPreviousEnabled ? .white : .white.opacity(0.25))
                        }
                    }
                    .disabled(!isPreviousEnabled)
                    
                    Spacer()
                    
                    VStack (spacing: 4) {
                        if #available(iOS 26.0, *) {
                            Text(author)
                                .font(.system(size: 15))
                                .lineLimit(1)
                                .foregroundStyle(.customBlack)
                            Text(bookName)
                                .font(.system(size: 15, weight: .semibold))
                                .lineLimit(1)
                                .foregroundStyle(.customBlack)
                        } else {
                            Text(author)
                                .font(.system(size: 15))
                                .lineLimit(1)
                                .foregroundStyle(.white)
                            Text(bookName)
                                .font(.system(size: 15, weight: .semibold))
                                .lineLimit(1)
                                .foregroundStyle(.white)
                        }
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        guard isNextEnabled else { return }
                        let impactHeavy = UIImpactFeedbackGenerator(style: .medium)
                        impactHeavy.impactOccurred()
                        nextAction()
                    }) {
                        if #available(iOS 26.0, *) {
                            Image(systemName: "forward.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(isNextEnabled ? .customBlack : .customBlack.opacity(0.25))
                        } else {
                            Image(systemName: "forward.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(isNextEnabled ? .white : .white.opacity(0.25))
                        }
                    }
                    .disabled(!isNextEnabled)
                }
                
                UISliderView(
                    value: $progress,
                    onEditingChanged: { isEditing in
                        self.isEditing = isEditing
                        if !isEditing {
                            time = progress * duration
                        }
                    }
                )
                .accentColor(.customIndigo)
                .controlSize(.mini)
                .onChange(of: time) { _, _ in
                    if !isEditing {
                        progress = time / duration
                    }
                }
                
                HStack {
                    if #available(iOS 26.0, *) {
                        Text(time.formatToTimeString())
                            .font(.system(size: 12))
                            .foregroundStyle(.customBlack)
                    } else {
                        Text(time.formatToTimeString())
                            .font(.system(size: 12))
                            .foregroundStyle(.white)
                    }
                    
                    Spacer()
                    
                    if #available(iOS 26.0, *) {
                        Text(duration.formatToTimeString())
                            .font(.system(size: 12))
                            .foregroundStyle(.customBlack)
                    } else {
                        Text(duration.formatToTimeString())
                            .font(.system(size: 12))
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(16)
            .background {
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.clear)
                        .glassEffect(in: .rect(cornerRadius: 12))
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                }
            }
            
            PlaybackSpeedSlider(
                playbackSpeed: $playbackSpeed,
                onSpeedChange: onSpeedChange
            )
            .padding(.top, 12)
        }
    }
}
