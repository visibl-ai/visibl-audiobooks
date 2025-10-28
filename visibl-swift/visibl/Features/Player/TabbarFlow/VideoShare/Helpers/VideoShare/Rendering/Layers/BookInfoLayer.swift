//
//  BookInfoLayer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

struct BookInfoLayer {
    /// Draws book title and author information
    static func draw(bookTitle: String, authorName: String, size: CGSize) {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left
        paragraphStyle.lineBreakMode = .byTruncatingTail
        paragraphStyle.maximumLineHeight = 20
        paragraphStyle.minimumLineHeight = 20

        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 16, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle
        ]

        let authorAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 16, weight: .regular),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle
        ]

        let topPadding: CGFloat = 20
        let leftPadding: CGFloat = 20
        let rightPadding: CGFloat = 20
        let elementSpacing: CGFloat = 8
        let lineHeight: CGFloat = 20
        let boxPadding: CGFloat = 8
        let boxCornerRadius: CGFloat = 8

        let titleSize = (bookTitle as NSString).size(withAttributes: titleAttributes)
        let authorSize = (authorName as NSString).size(withAttributes: authorAttributes)

        // Draw title background
        let titleY = topPadding
        let titleBoxRect = CGRect(
            x: leftPadding - boxPadding,
            y: titleY,
            width: min(titleSize.width + (boxPadding * 2), size.width - leftPadding - rightPadding + (boxPadding * 2)),
            height: lineHeight + (boxPadding * 2)
        )
        let titleBoxPath = UIBezierPath(roundedRect: titleBoxRect, cornerRadius: boxCornerRadius)
        UIColor.black.withAlphaComponent(0.5).setFill()
        titleBoxPath.fill()

        // Draw author background
        let authorY = titleY + lineHeight + (boxPadding * 2) + elementSpacing
        let authorBoxRect = CGRect(
            x: leftPadding - boxPadding,
            y: authorY,
            width: min(authorSize.width + (boxPadding * 2), size.width - leftPadding - rightPadding + (boxPadding * 2)),
            height: lineHeight + (boxPadding * 2)
        )
        let authorBoxPath = UIBezierPath(roundedRect: authorBoxRect, cornerRadius: boxCornerRadius)
        UIColor.black.withAlphaComponent(0.5).setFill()
        authorBoxPath.fill()

        let maxWidth = size.width - leftPadding - rightPadding

        // Draw text
        let titleRect = CGRect(x: leftPadding, y: titleY + boxPadding, width: maxWidth, height: lineHeight)
        let authorRect = CGRect(x: leftPadding, y: authorY + boxPadding, width: maxWidth, height: lineHeight)

        (bookTitle as NSString).draw(in: titleRect, withAttributes: titleAttributes)
        (authorName as NSString).draw(in: authorRect, withAttributes: authorAttributes)
    }
}
