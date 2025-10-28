//
//  FirebaseDecoder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase

final class FirebaseDecoder {
    static func decode<T: Codable>(_ snapshot: DataSnapshot) -> T? {
        guard let dict = snapshot.value as? [String: Any],
              let jsonData = try? JSONSerialization.data(withJSONObject: dict),
              let model = try? JSONDecoder().decode(T.self, from: jsonData) else {
            return nil
        }
        return model
    }
}
