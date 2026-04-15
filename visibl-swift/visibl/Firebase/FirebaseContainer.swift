//
//  FirebaseContainer.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import FirebaseDatabase

class FirebaseContainer {
    static let shared = FirebaseContainer()

    let db: DatabaseReference

    private init() {
        let database = Database.database(url: Constants.rtdbURL)
        database.isPersistenceEnabled = true
        db = database.reference()
    }
}
