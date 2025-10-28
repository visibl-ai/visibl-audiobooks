//
//  KeyNameDecodable.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

/**
 A protocol that enables flexible decoding of JSON that can be either an array or a dictionary.
 
 When the JSON is a dictionary, the keys become the `name` property of the decoded objects.
 
 ## Usage:
 
 1. Make your struct conform to `KeyNameDecodable`
 2. Create a nested `Data` struct with the properties you want to decode
 3. Implement the required `init(name:data:)` initializer
 4. Use `decodeFlexible` in your decoder
 
 ## Example:
 
 ```swift
 struct Character: Codable, KeyNameDecodable {
     let name: String
     let description: String?
     
     // Nested data struct for decoding
     struct Data: Codable {
         let description: String?
     }
     
     typealias DataType = Data
     
     init(name: String, data: Data) {
         self.name = name
         self.description = data.description
     }
 }
 
 // In your decoder:
 characters = try container.decodeFlexible(Character.self, forKey: .characters)
 ```
 
 ## Supported JSON formats:
 
 **Array format:**
 ```json
 {
   "characters": [
     {"name": "alice", "description": "Main character"},
     {"name": "bob", "description": "Side character"}
   ]
 }
 ```
 
 **Dictionary format:**
 ```json
 {
   "characters": {
     "alice": {"description": "Main character"},
     "bob": {"description": "Side character"}
   }
 }
 ```
 
 Both formats will decode to the same array of `Character` objects.
 */
protocol KeyNameDecodable: Codable {
    associatedtype DataType: Codable
    init(name: String, data: DataType)
}

extension KeyedDecodingContainer {
    /**
     Decodes a value that can be either an array or a dictionary.
     
     - Parameter type: The type to decode that conforms to `KeyNameDecodable`
     - Parameter key: The coding key for the value
     - Returns: An array of decoded objects
     - Throws: DecodingError if neither array nor dictionary format can be decoded
     */
    func decodeFlexible<T: KeyNameDecodable>(_ type: T.Type, forKey key: Key) throws -> [T] {
        if let array = try? decode([T].self, forKey: key) {
            return array
        } else {
            let dict = try decode([String: T.DataType].self, forKey: key)
            return dict.map { T(name: $0.key, data: $0.value) }
        }
    }
}

extension KeyedDecodingContainer {
    /**
     Decodes a value that can be either an array or a dictionary, returning nil if the key doesn't exist.
     
     - Parameter type: The type to decode that conforms to `KeyNameDecodable`
     - Parameter key: The coding key for the value
     - Returns: An array of decoded objects, or nil if the key doesn't exist
     - Throws: DecodingError if the key exists but neither array nor dictionary format can be decoded
     */
    func decodeFlexibleIfPresent<T: KeyNameDecodable>(_ type: T.Type, forKey key: Key) throws -> [T]? {
        guard contains(key) else { return nil }
        return try decodeFlexible(type, forKey: key)
    }
}
