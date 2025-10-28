//
//  FirebaseDataNormalizer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct FirebaseDataNormalizer {
    static func normalizeToArray<T: Decodable>(_ value: Any, elementType: T.Type, preserveIndices: Bool = false) -> [T?]? {
        if let array = value as? [Any] {
            return decodeArrayWithNils(array, elementType: elementType)
        } else if let dict = value as? [String: Any] {
            if preserveIndices {
                // Preserve original indices, fill gaps with nil
                let maxIndex = dict.keys.compactMap { Int($0) }.max() ?? 0
                var resultArray = [Any?](repeating: nil, count: maxIndex + 1)

                for (key, value) in dict {
                    if let index = Int(key) {
                        resultArray[index] = value
                    }
                }

                return decodeArrayWithNils(resultArray, elementType: elementType)
            } else {
                // Compact array without gaps
                let sortedKeys = dict.keys.compactMap { Int($0) }.sorted()
                let orderedArray = sortedKeys.compactMap { dict[String($0)] }
                return decodeArrayWithNils(orderedArray, elementType: elementType)
            }
        }
        return nil
    }

    static func normalizeToNestedArray<T: Decodable>(_ value: Any, elementType: T.Type, preserveIndices: Bool = false) -> [[T]]? {
        if let outerArray = value as? [Any] {
            if preserveIndices {
                // Preserve indices, replace nils with empty arrays
                return outerArray.map { innerValue -> [T] in
                    if innerValue is NSNull {
                        return []
                    }
                    return normalizeToArray(innerValue, elementType: elementType, preserveIndices: false)?.compactMap { $0 } ?? []
                }
            } else {
                return outerArray.compactMap { innerValue in
                    normalizeToArray(innerValue, elementType: elementType, preserveIndices: false)?.compactMap { $0 }
                }
            }
        } else if let outerDict = value as? [String: Any] {
            if preserveIndices {
                // Preserve original indices in outer array
                let maxIndex = outerDict.keys.compactMap { Int($0) }.max() ?? 0
                var resultArray = [[T]?](repeating: nil, count: maxIndex + 1)

                for (key, innerValue) in outerDict {
                    if let index = Int(key) {
                        resultArray[index] = normalizeToArray(innerValue, elementType: elementType, preserveIndices: false)?.compactMap { $0 }
                    }
                }

                // Replace nils with empty arrays for consistency
                return resultArray.map { $0 ?? [] }
            } else {
                let sortedKeys = outerDict.keys.compactMap { Int($0) }.sorted()
                return sortedKeys.compactMap { key in
                    guard let innerValue = outerDict[String(key)] else { return nil }
                    return normalizeToArray(innerValue, elementType: elementType, preserveIndices: false)?.compactMap { $0 }
                }
            }
        }
        return nil
    }

    private static func decodeArray<T: Decodable>(_ array: [Any], elementType: T.Type) -> [T]? {
        do {
            let data = try JSONSerialization.data(withJSONObject: array)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .secondsSince1970
            return try decoder.decode([T].self, from: data)
        } catch {
            print("Failed to decode array: \(error)")
            return nil
        }
    }

    private static func decodeArrayWithNils<T: Decodable>(_ array: [Any?], elementType: T.Type) -> [T?]? {
        do {
            // Replace nils with NSNull for JSON serialization
            let processedArray = array.map { $0 ?? NSNull() }
            let data = try JSONSerialization.data(withJSONObject: processedArray)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .secondsSince1970
            return try decoder.decode([T?].self, from: data)
        } catch {
            print("Failed to decode array with nils: \(error)")
            return nil
        }
    }
}