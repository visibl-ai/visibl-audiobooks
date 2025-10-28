//
//  PixelBufferRenderer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import CoreVideo

final class PixelBufferRenderer {
    /// Creates a pixel buffer with watermark, book info, and progress line
    static func createPixelBuffer(
        from image: UIImage,
        size: CGSize,
        watermarkImage: UIImage?,
        watermarkSize: CGSize,
        progress: Double,
        bookTitle: String,
        authorName: String,
        styleName: String
    ) async throws -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        let attrs = [
            kCVPixelBufferCGImageCompatibilityKey: kCFBooleanTrue!,
            kCVPixelBufferCGBitmapContextCompatibilityKey: kCFBooleanTrue!
        ] as CFDictionary

        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            Int(size.width),
            Int(size.height),
            kCVPixelFormatType_32ARGB,
            attrs,
            &pixelBuffer
        )

        guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
            throw VideoError.failedToCreatePixelBuffer
        }

        CVPixelBufferLockBaseAddress(buffer, [])

        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: Int(size.width),
            height: Int(size.height),
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        ) else {
            CVPixelBufferUnlockBaseAddress(buffer, [])
            throw VideoError.failedToCreateContext
        }

        // Flip coordinate system
        context.translateBy(x: 0, y: size.height)
        context.scaleBy(x: 1.0, y: -1.0)

        UIGraphicsPushContext(context)

        // Draw all layers
        ImageLayer.draw(image: image, size: size)
        BookInfoLayer.draw(bookTitle: bookTitle, authorName: authorName, size: size)
        BottomElementsLayer.draw(
            styleName: styleName,
            size: size,
            watermarkImage: watermarkImage,
            watermarkSize: watermarkSize
        )
        ProgressLineLayer.draw(in: context, size: size, progress: progress)

        UIGraphicsPopContext()
        CVPixelBufferUnlockBaseAddress(buffer, [])

        return buffer
    }
}
