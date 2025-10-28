//
//  RTDBManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase
import FirebaseAuth

enum DatabaseError: LocalizedError {
    case noData
    case decodingError
    case unauthorized
    case invalidPath
    
    var errorDescription: String? {
        switch self {
        case .noData: return "No data available"
        case .decodingError: return "Failed to decode data"
        case .unauthorized: return "User is not authenticated"
        case .invalidPath: return "Invalid database path"
        }
    }
}

final class RTDBManager {
    // MARK: - Singleton
    static let shared = RTDBManager()
    
    let databaseRef: DatabaseReference
    private var observers: [String: [DatabaseHandle]] = [:]
    
    private init() {
        Database.database().isPersistenceEnabled = true
        
        let database = Database.database(url: Constants.rtdbURL)
        database.isPersistenceEnabled = true
        databaseRef = database.reference()
    }
    
    // MARK: - Observer Methods (Path)
    
    func observeDataChanges<T: Decodable>(
        at path: String,
        type: T.Type,
        onChange: @escaping (DatabaseChange<T>) -> Void
    ) {
        let ref = databaseRef.child(path)
        var handles: [DatabaseHandle] = []
        
        let addedHandle = ref.observe(.childAdded) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .added, type: type, onChange: onChange)
        }
        handles.append(addedHandle)
        
        let modifiedHandle = ref.observe(.childChanged) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .modified, type: type, onChange: onChange)
        }
        handles.append(modifiedHandle)
        
        let removedHandle = ref.observe(.childRemoved) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .removed, type: type, onChange: onChange)
        }
        handles.append(removedHandle)
        
        observers[path] = handles
    }
    
    // MARK: - Observer Methods (Query)
    
    func observeDataChanges<T: Decodable>(
        at query: DatabaseQuery,
        type: T.Type,
        onChange: @escaping (DatabaseChange<T>) -> Void
    ) -> [DatabaseHandle] {
        var handles: [DatabaseHandle] = []
        
        let addedHandle = query.observe(.childAdded) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .added, type: type, onChange: onChange)
        }
        handles.append(addedHandle)
        
        let modifiedHandle = query.observe(.childChanged) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .modified, type: type, onChange: onChange)
        }
        handles.append(modifiedHandle)
        
        let removedHandle = query.observe(.childRemoved) { [weak self] snapshot in
            self?.handleDataSnapshot(snapshot, event: .removed, type: type, onChange: onChange)
        }
        handles.append(removedHandle)
        
        return handles
    }
    
    func observeSingleObjectNew<T: Decodable>(
        at path: String,
        type: T.Type,
        onChange: @escaping (DatabaseChange<T>) -> Void
    ) {
        print("🔧 RTDBService: Setting up single object observer at: \(path)")
        let ref = databaseRef.child(path)
        
        let handle = ref.observe(.value) { snapshot in
            print("🔧 RTDBService: Received snapshot for path: \(path)")
            print("  └─ Exists: \(snapshot.exists())")
            
            if snapshot.exists() {
                guard let dict = snapshot.value as? [String: Any] else {
                    print("  ❌ Failed to cast snapshot value to dictionary")
                    return
                }
                
                print("  └─ Dictionary: \(dict)")
                
                do {
                    let data = try JSONSerialization.data(withJSONObject: dict)
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .secondsSince1970
                    let item = try decoder.decode(T.self, from: data)
                    print("  ✅ Successfully decoded object of type \(T.self)")
                    
                    // Determine if this is the first time we see data (added) or an update (modified)
                    // For simplicity, we'll treat the first observation as "added" and subsequent as "modified"
                    let changeType: DatabaseChangeType = .added
                    
                    DispatchQueue.main.async {
                        onChange(DatabaseChange(type: changeType, item: item))
                    }
                } catch {
                    print("  ❌ Decoding error: \(error)")
                }
            } else {
                print("  ⚠️ No data exists at path - treating as removed")
                // If there's no data, we can't create an item, so we might need a different approach
                // For now, we'll skip the callback when there's no data
            }
        }
        
        observers[path] = [handle]
        print("🔧 RTDBService: Observer registered successfully")
    }
    
    func observeSingleObject<T: Decodable>(
        at path: String,
        type: T.Type,
        onChange: @escaping (Result<T, Error>) -> Void
    ) -> DatabaseHandle {
        let ref = databaseRef.child(path)
        return ref.observe(.value) { snapshot in
            guard let value = snapshot.value else {
                return DispatchQueue.main.async { onChange(.failure(DatabaseError.noData)) }
            }

            // Ensure we have a valid JSON object (Dictionary or Array); otherwise, wrap the scalar.
            let jsonObject: Any = (value is [Any] || value is [String: Any]) ? value : ["value": value]

            do {
                let data = try JSONSerialization.data(withJSONObject: jsonObject, options: [])
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .secondsSince1970
                let decodedData = try decoder.decode(T.self, from: data)
                DispatchQueue.main.async {
                    onChange(.success(decodedData))
                }
            } catch {
                print("Decoding error: \(error)")
                DispatchQueue.main.async {
                    onChange(.failure(error))
                }
            }
        }
    }

    func observeNormalizedNestedArray<T: Decodable>(
        at path: String,
        elementType: T.Type,
        preserveIndices: Bool = true,
        onChange: @escaping (Result<[[T]], Error>) -> Void
    ) -> DatabaseHandle {
        let ref = databaseRef.child(path)
        return ref.observe(.value) { snapshot in
            guard let value = snapshot.value else {
                return DispatchQueue.main.async { onChange(.failure(DatabaseError.noData)) }
            }

            if let normalizedArray = FirebaseDataNormalizer.normalizeToNestedArray(value, elementType: elementType, preserveIndices: preserveIndices) {
                DispatchQueue.main.async {
                    onChange(.success(normalizedArray))
                }
            } else {
                DispatchQueue.main.async {
                    onChange(.failure(DatabaseError.decodingError))
                }
            }
        }
    }
    
    private func handleDataSnapshot<T: Decodable>(
        _ snapshot: DataSnapshot,
        event: DatabaseChangeType,
        type: T.Type,
        onChange: @escaping (DatabaseChange<T>) -> Void
    ) {
        guard var value = snapshot.value as? [String: Any] else { return }
        
        do {
            value["id"] = snapshot.key
            
            let data = try JSONSerialization.data(withJSONObject: value)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .secondsSince1970
            
            let decodedData = try decoder.decode(T.self, from: data)
            let change = DatabaseChange(type: event, item: decodedData)
            
            DispatchQueue.main.async {
                onChange(change)
            }
        } catch {
            print("Decoding error: \(error)")
        }
    }
    
    // MARK: - Write Methods
    
    func writeDataWithCompletion<T: Encodable>(
        to path: String,
        value: T,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        do {
            let jsonData = try JSONEncoder().encode(value)
            guard let dictionary = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                completion(.failure(DatabaseError.decodingError))
                return
            }
            
            databaseRef.child(path).setValue(dictionary) { error, _ in
                if let error = error {
                    completion(.failure(error))
                } else {
                    completion(.success(()))
                }
            }
        } catch {
            completion(.failure(error))
        }
    }
    
    func writeData<T: Encodable>(to path: String, value: T) {
        let dataToWrite: Any
        
        switch value {
        case let stringValue as String:
            dataToWrite = stringValue
            
        case let boolValue as Bool:
            dataToWrite = boolValue
            
        default:
            do {
                let jsonData = try JSONEncoder().encode(value)
                let jsonObject = try JSONSerialization.jsonObject(with: jsonData, options: [])
                dataToWrite = jsonObject
            } catch {
                print("Encoding error:", error)
                return
            }
        }
        
        databaseRef.child(path).setValue(dataToWrite) { error, _ in
            if let error = error {
                print("Database write error:", error)
            }
        }
    }
    
    // MARK: - One-Time Read Method (Path)
    
    func readDataFromPath<T: Decodable>(
        from path: String,
        type: T.Type,
        completion: @escaping (Result<T, Error>) -> Void
    ) {
        print("📍 Reading data from path: \(path)")
        print("📍 Expected type: \(T.self)")
        
        databaseRef.child(path).getData { error, snapshot in
            if let error = error {
                print("❌ Network/Firebase error: \(error)")
                completion(.failure(error))
                return
            }
            
            guard let snapshot = snapshot else {
                print("❌ No snapshot returned")
                completion(.failure(DatabaseError.noData))
                return
            }
            
            print("📊 Snapshot exists: \(snapshot.exists())")
            print("📊 Snapshot key: \(snapshot.key)")
            print("📊 Children count: \(snapshot.childrenCount)")
            
            guard let value = snapshot.value else {
                print("❌ Snapshot.value is nil")
                completion(.failure(DatabaseError.noData))
                return
            }
            
            // Debug: Print raw value type and content
            print("📊 Value is NSNull: \(value is NSNull)")
            
            // Print raw value (truncate if too large)
            let valueString = String(describing: value)
            if valueString.count > 500 {
                print("📊 Raw value (truncated): \(valueString.prefix(500))...")
            } else {
                print("📊 Raw value: \(valueString)")
            }
            
            if value is NSNull {
                print("⚠️ Value is NSNull, attempting to return empty collection")
                if let emptyValue = [] as? T {
                    print("✅ Returning empty array")
                    completion(.success(emptyValue))
                } else if let emptyDict = [:] as? T {
                    print("✅ Returning empty dictionary")
                    completion(.success(emptyDict))
                } else {
                    print("❌ Cannot create empty instance of \(T.self)")
                    completion(.failure(DatabaseError.noData))
                }
                return
            }
            
            do {
                print("🔄 Attempting JSON serialization...")
                let data = try JSONSerialization.data(withJSONObject: value)
                print("✅ JSON data created: \(data.count) bytes")
                
                // Debug: Print JSON string
                if let jsonString = String(data: data, encoding: .utf8) {
                    if jsonString.count > 500 {
                        print("📊 JSON string (truncated): \(jsonString.prefix(500))...")
                    } else {
                        print("📊 JSON string: \(jsonString)")
                    }
                }
                
                print("🔄 Attempting to decode as \(T.self)...")
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .secondsSince1970
                let decodedData = try decoder.decode(T.self, from: data)
                
                // Debug: Print successful decode info
                if let dict = decodedData as? [String: Any] {
                    print("✅ Successfully decoded dictionary with \(dict.count) keys")
                } else if let array = decodedData as? [Any] {
                    print("✅ Successfully decoded array with \(array.count) items")
                } else {
                    print("✅ Successfully decoded \(T.self)")
                }
                
                completion(.success(decodedData))
            } catch {
                print("❌ Decoding error: \(error)")
                print("❌ Error details: \(error.localizedDescription)")
                if let decodingError = error as? DecodingError {
                    switch decodingError {
                    case .typeMismatch(let type, let context):
                        print("   Type mismatch: expected \(type), context: \(context)")
                    case .valueNotFound(let type, let context):
                        print("   Value not found: \(type), context: \(context)")
                    case .keyNotFound(let key, let context):
                        print("   Key not found: \(key), context: \(context)")
                    case .dataCorrupted(let context):
                        print("   Data corrupted: \(context)")
                    @unknown default:
                        print("   Unknown decoding error")
                    }
                }
                completion(.failure(DatabaseError.decodingError))
            }
        }
    }
    
    // MARK: - One-Time Read Method (Query)
    
    func getDataFromQuery<T: Decodable>(
        from query: DatabaseQuery,
        type: T.Type,
        completion: @escaping (Result<T, Error>) -> Void
    ) {
        query.getData { error, snapshot in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let snapshot = snapshot else {
                completion(.failure(DatabaseError.noData))
                return
            }
            
            guard let value = snapshot.value else {
                completion(.failure(DatabaseError.noData))
                return
            }
            
            if value is NSNull {
                if let emptyValue = [] as? T {
                    completion(.success(emptyValue))
                } else if let emptyDict = [:] as? T {
                    completion(.success(emptyDict))
                } else {
                    completion(.failure(DatabaseError.noData))
                }
                return
            }
            
            do {
                let data = try JSONSerialization.data(withJSONObject: value)
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .secondsSince1970
                let decodedData = try decoder.decode(T.self, from: data)
                completion(.success(decodedData))
            } catch {
                print("Decoding error: \(error)")
                completion(.failure(DatabaseError.decodingError))
            }
        }
    }
    
    // MARK: - Delete Data
    func deleteData(at path: String) async throws {
        try await databaseRef.child(path).removeValue()
    }
    
    // MARK: - Cleanup Methods
    
    func removeObserver(for path: String) {
        guard let handles = observers[path] else { return }
        
        for handle in handles {
            databaseRef.child(path).removeObserver(withHandle: handle)
        }
        
        observers.removeValue(forKey: path)
    }
    
    func removeAllObservers() {
        observers.forEach { path, handles in
            handles.forEach { handle in
                databaseRef.child(path).removeObserver(withHandle: handle)
            }
        }
        
        observers.removeAll()
    }
}

extension RTDBManager {
    
    /// Observes an array of `SceneModel` from the given path, ordered by "startTime".
    ///
    /// - Parameters:
    ///   - path: The path in Firebase RTDB where SceneModel records are stored.
    ///   - completion: Closure called whenever the `.value` event fires, returning the current array of scenes.
    /// - Returns: The `DatabaseHandle` for removing the observer if needed.
    func observeOrderedScenes(
        at path: String,
        completion: @escaping ([SceneModel]) -> Void
    ) -> DatabaseHandle {
        
        let query = databaseRef
            .child(path)
            .queryOrdered(byChild: "startTime")
        
        // Observe value events
        let handle = query.observe(.value) { snapshot in
            var scenes: [SceneModel] = []
            
            // Decode each child as SceneModel
            for child in snapshot.children {
                if
                    let childSnapshot = child as? DataSnapshot,
                    let scene: SceneModel = FirebaseDecoder.decode(childSnapshot)
                {
                    scenes.append(scene)
                }
            }
            
            // Sort by startTime
            scenes.sort { $0.startTime < $1.startTime }
            
            // Return results
            completion(scenes)
        }
        
        // Store the handle internally so we can remove it later
        if var existingHandles = observers[path] {
            existingHandles.append(handle)
            observers[path] = existingHandles
        } else {
            observers[path] = [handle]
        }
        
        return handle
    }
}

extension RTDBManager {
    func removeObserver(handle: DatabaseHandle, at path: String) {
        databaseRef.child(path).removeObserver(withHandle: handle)
    }
}

// MARK: - Supporting Types

enum DatabaseChangeType {
    case added
    case modified
    case removed
}

struct DatabaseChange<T> {
    let type: DatabaseChangeType
    let item: T
}
