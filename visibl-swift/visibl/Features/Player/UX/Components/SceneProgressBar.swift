//
//  SceneProgressBar.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SceneProgressBar: View {
    let sceneStartTime: TimeInterval?
    let sceneDuration: TimeInterval
    let sceneIdentifier: String?
    let sceneIndex: Int?
    let currentTime: TimeInterval?
    let playbackSpeed: Double
    let isPlaying: Bool

    @State private var baseProgress: Double = 0
    @State private var animationStartDate: Date?
    @State private var lastPlaybackSpeed: Double = 1.0

    private var effectiveDuration: TimeInterval {
        max(sceneDuration, 0.001)
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            let progress = resolvedProgress(at: timeline.date)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.gray)
                    .frame(height: 3)

                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(height: 3)
                    .scaleEffect(x: progress, y: 1, anchor: .leading)
            }
        }
        .frame(height: 3)
        .id(currentSceneID)
        .onAppear {
            configureInitialState()
        }
        .onChange(of: sceneIdentifier) { _, _ in
            resetForSceneChange()
        }
        .onChange(of: sceneIndex) { _, _ in
            resetForSceneChange()
        }
        .onChange(of: sceneStartTime) { _, _ in
            updateProgressFromCurrentTime(restartAnimation: isPlaying)
        }
        .onChange(of: sceneDuration) { _, _ in
            updateProgressFromCurrentTime(restartAnimation: isPlaying)
        }
        .onChange(of: currentTime) { _, _ in
            updateProgressFromCurrentTime(restartAnimation: true)
        }
        .onChange(of: isPlaying) { _, playing in
            if playing {
                resumeAnimation()
            } else {
                pauseAnimation()
            }
        }
        .onChange(of: playbackSpeed) { _, newSpeed in
            handlePlaybackSpeedChange(newSpeed)
        }
    }

    private func resolvedProgress(at date: Date) -> Double {
        guard let startDate = animationStartDate, isPlaying else {
            return clamp(baseProgress)
        }

        let elapsed = date.timeIntervalSince(startDate)
        let adjustedElapsed = elapsed * max(playbackSpeed, 0)
        let progress = baseProgress + adjustedElapsed / effectiveDuration
        return clamp(progress)
    }

    private func configureInitialState() {
        lastPlaybackSpeed = playbackSpeed
        baseProgress = computeProgressFromCurrentTime() ?? clamp(baseProgress)
        animationStartDate = isPlaying && sceneDuration > 0 ? Date() : nil
    }

    private func resetForSceneChange() {
        baseProgress = computeProgressFromCurrentTime() ?? 0
        animationStartDate = isPlaying && sceneDuration > 0 ? Date() : nil
        lastPlaybackSpeed = playbackSpeed
    }

    private func updateProgressFromCurrentTime(restartAnimation: Bool) {
        guard let progress = computeProgressFromCurrentTime() else { return }
        baseProgress = progress

        guard restartAnimation, isPlaying, sceneDuration > 0 else { return }
        animationStartDate = Date()
    }

    private func pauseAnimation() {
        baseProgress = progress(using: playbackSpeed, at: Date())
        animationStartDate = nil
    }

    private func resumeAnimation() {
        guard sceneDuration > 0 else { return }
        updateProgressFromCurrentTime(restartAnimation: true)
        if animationStartDate == nil {
            animationStartDate = Date()
        }
        lastPlaybackSpeed = playbackSpeed
    }

    private func handlePlaybackSpeedChange(_ newSpeed: Double) {
        guard animationStartDate != nil, sceneDuration > 0 else {
            lastPlaybackSpeed = newSpeed
            return
        }

        let currentProgress = progress(using: lastPlaybackSpeed, at: Date())
        baseProgress = currentProgress
        animationStartDate = Date()
        lastPlaybackSpeed = newSpeed
    }

    private func computeProgressFromCurrentTime() -> Double? {
        guard let start = sceneStartTime,
              let current = currentTime,
              sceneDuration > 0 else {
            return nil
        }

        let elapsed = current - start
        let progress = elapsed / effectiveDuration
        return clamp(progress)
    }

    private func progress(using speed: Double, at date: Date) -> Double {
        guard let startDate = animationStartDate else {
            return clamp(baseProgress)
        }

        let elapsed = date.timeIntervalSince(startDate)
        let adjustedElapsed = elapsed * max(speed, 0)
        let progress = baseProgress + adjustedElapsed / effectiveDuration
        return clamp(progress)
    }

    private func clamp(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }

    private var currentSceneID: String {
        if let sceneIdentifier, !sceneIdentifier.isEmpty {
            return sceneIdentifier
        }
        if let sceneIndex {
            return "scene-index-\(sceneIndex)"
        }
        return "scene-progress-default"
    }
}
