//
//  String+Ext.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

extension String {
    /// Converts a hexadecimal string to Data
    func hexData() -> Data? {
        let hex = self
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "0x", with: "", options: .caseInsensitive)
        
        guard hex.count.isMultiple(of: 2) else { return nil }
        
        var data = Data()
        data.reserveCapacity(hex.count / 2)
        
        for i in stride(from: 0, to: hex.count, by: 2) {
            let start = hex.index(hex.startIndex, offsetBy: i)
            let end = hex.index(start, offsetBy: 2)
            guard let byte = UInt8(hex[start..<end], radix: 16) else { return nil }
            data.append(byte)
        }
        
        return data
    }
}
