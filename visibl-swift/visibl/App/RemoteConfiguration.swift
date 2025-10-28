//
//  RemoteConfiguration.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

final class RemoteConfiguration: ObservableObject {
    static let shared = RemoteConfiguration()
    
    @Published var aaxProvider: AAXProviderModel?
    @Published var currentAppVersion: String?
    @Published var newVersionURLString: String?
}

struct AAXProviderModel: Codable {
    let name: String
    let company: String
    let logo: String
    let consentURL: String
}
