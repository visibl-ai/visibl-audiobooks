//
//  ImageLayer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

struct ImageLayer {
    /// Draws the main image to fill the entire frame
    static func draw(image: UIImage, size: CGSize) {
        image.draw(in: CGRect(origin: .zero, size: size))
    }
}
