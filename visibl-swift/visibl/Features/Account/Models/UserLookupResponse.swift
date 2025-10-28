//
//  UserLookupResponse.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct UserLookupResponse: Codable {
    let exists: Bool
    let uid: String?
    let email: String?
}
