//
//  BottomElementsLayer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

struct BottomElementsLayer {
    private static let copyrightText: NSString = "created with visibl.ai"

    /// Draws bottom text elements and watermark
    static func draw(
        styleName: String,
        size: CGSize,
        watermarkImage: UIImage?,
        watermarkSize: CGSize
    ) {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left
        paragraphStyle.lineBreakMode = .byTruncatingTail

        let textAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 16, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle
        ]

        let styleNameText = styleName as NSString
        let copyrightSize = copyrightText.size(withAttributes: textAttributes)
        let styleNameSize = styleNameText.size(withAttributes: textAttributes)

        let bottomPadding: CGFloat = 20
        let leftPadding: CGFloat = 20
        let boxPadding: CGFloat = 8
        let boxCornerRadius: CGFloat = 8
        let elementSpacing: CGFloat = 8

        let totalHeight = (styleNameSize.height + boxPadding * 2) +
                         (copyrightSize.height + boxPadding * 2) +
                         elementSpacing

        let startY = size.height - bottomPadding - totalHeight

        // Draw style name tag
        drawStyleNameTag(
            styleName: styleNameText,
            position: CGPoint(x: leftPadding, y: startY + boxPadding),
            textSize: styleNameSize,
            attributes: textAttributes,
            boxPadding: boxPadding,
            boxCornerRadius: boxCornerRadius
        )

        // Draw copyright
        let copyrightY = startY + (styleNameSize.height + boxPadding * 2) + elementSpacing + boxPadding
        let copyrightBoxRect = CGRect(
            x: leftPadding - boxPadding,
            y: copyrightY - boxPadding,
            width: copyrightSize.width + (boxPadding * 2),
            height: copyrightSize.height + (boxPadding * 2)
        )
        let copyrightBoxPath = UIBezierPath(roundedRect: copyrightBoxRect, cornerRadius: boxCornerRadius)
        UIColor.black.withAlphaComponent(0.5).setFill()
        copyrightBoxPath.fill()

        copyrightText.draw(
            at: CGPoint(x: leftPadding, y: copyrightY),
            withAttributes: textAttributes
        )

        // Draw watermark
        if let watermarkImage = watermarkImage {
            let scaledWatermarkSize = CGSize(
                width: watermarkSize.width * 0.7,
                height: watermarkSize.height * 0.7
            )

            let logoRect = CGRect(
                x: size.width - scaledWatermarkSize.width - 20,
                y: size.height - scaledWatermarkSize.height - bottomPadding - 10,
                width: scaledWatermarkSize.width,
                height: scaledWatermarkSize.height
            )

            watermarkImage.draw(in: logoRect, blendMode: .normal, alpha: 0.7)
        }
    }

    private static func drawStyleNameTag(
        styleName: NSString,
        position: CGPoint,
        textSize: CGSize,
        attributes: [NSAttributedString.Key: Any],
        boxPadding: CGFloat,
        boxCornerRadius: CGFloat
    ) {
        let boxRect = CGRect(
            x: position.x - boxPadding,
            y: position.y - boxPadding,
            width: textSize.width + (boxPadding * 2),
            height: textSize.height + (boxPadding * 2)
        )

        let boxPath = UIBezierPath(roundedRect: boxRect, cornerRadius: boxCornerRadius)

        UIGraphicsGetCurrentContext()?.saveGState()
        UIColor.black.withAlphaComponent(0.5).setFill()
        boxPath.fill()
        UIGraphicsGetCurrentContext()?.restoreGState()

        styleName.draw(at: position, withAttributes: attributes)
    }
}
