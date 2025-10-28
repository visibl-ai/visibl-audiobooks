//
//  ProgressLineLayer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

struct ProgressLineLayer {
    /// Draws a progress line at the bottom of the frame
    static func draw(in context: CGContext, size: CGSize, progress: Double) {
        let progressLineHeight: CGFloat = 5
        let progressLineYPosition = size.height - progressLineHeight
        let progressLineWidth = size.width * CGFloat(progress)

        // Draw background
        let backgroundRect = CGRect(x: 0, y: progressLineYPosition, width: size.width, height: progressLineHeight)
        context.setFillColor(UIColor.lightGray.withAlphaComponent(0.2).cgColor)
        context.fill(backgroundRect)

        // Draw progress
        let foregroundRect = CGRect(x: 0, y: progressLineYPosition, width: progressLineWidth, height: progressLineHeight)
        context.setFillColor(UIColor.white.cgColor)
        context.fill(foregroundRect)
    }
}
