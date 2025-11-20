//
//  String+localized.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

extension String {
    public var localized: String {
        return NSLocalizedString(self, comment: "")
    }
    
    public func localizedFormat(_ args: CVarArg...) -> String {
        String(format: self.localized, arguments: args)
    }
}

extension String: @retroactive Error {}
extension String: @retroactive LocalizedError {
    public var errorDescription: String? { return self }
}
