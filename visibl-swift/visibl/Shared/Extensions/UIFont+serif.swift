//
//  UIFont+serif.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit

extension UIFont {
    func withSerifDesign() -> UIFont {
        let newDescriptor = fontDescriptor.withDesign(.serif) ?? fontDescriptor
        return UIFont(descriptor: newDescriptor, size: 0)
    }
}
