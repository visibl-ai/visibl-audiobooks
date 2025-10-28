//
//  FirebaseReferenceStore.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseDatabase

class FirebaseReferenceStore {
    private var references: [String: (DatabaseReference?, DatabaseHandle?)] = [:]
    
    func add(reference: DatabaseReference, handle: DatabaseHandle, forKey key: String) {
        // Remove existing reference first
        remove(forKey: key)
        
        // Store new reference and handle
        references[key] = (reference, handle)
    }
    
    func remove(forKey key: String) {
        if let (reference, handle) = references[key],
           let ref = reference,
           let h = handle {
            ref.removeObserver(withHandle: h)
            references.removeValue(forKey: key)
        }
    }
    
    func removeAll() {
        references.forEach { key, value in
            if let (reference, handle) = references[key],
               let ref = reference,
               let h = handle {
                ref.removeObserver(withHandle: h)
            }
        }
        references.removeAll()
    }
    
    deinit {
        removeAll()
    }
}
