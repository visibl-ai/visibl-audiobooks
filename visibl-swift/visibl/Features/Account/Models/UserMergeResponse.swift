//
//  UserMergeResponse.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct UserMergeResponse: Codable {
    let isDeleted: Bool?
    let fcmToken: String?
    let deletedAt: String?
    let mergedIntoUid: String?
}
