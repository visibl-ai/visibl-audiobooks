//
//  URL+Identifiable.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

extension URL: @retroactive Identifiable {
    public var id: URL { self }
}
