//
//  AAXAuthData.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import AAXConnectSwift
import FirebaseAuth

struct AAXUserInfo: Codable {
    let customerInfo: AAXCustomerInfo
    
    enum CodingKeys: String, CodingKey {
        case customerInfo = "customer_info"
    }
}

struct AAXCustomerInfo: Codable {
    let userId: String
    let accountPool: String
    let name: String
    let givenName: String
    let homeRegion: String
    
    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accountPool = "account_pool"
        case name
        case givenName = "given_name"
        case homeRegion = "home_region"
    }
    
    // Custom initializer to decode from AnyCodable wrapper
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        let userIdCodable = try container.decode(AnyCodable.self, forKey: .userId)
        let accountPoolCodable = try container.decode(AnyCodable.self, forKey: .accountPool)
        let nameCodable = try container.decode(AnyCodable.self, forKey: .name)
        let givenNameCodable = try container.decode(AnyCodable.self, forKey: .givenName)
        let homeRegionCodable = try container.decode(AnyCodable.self, forKey: .homeRegion)
        
        guard let userId = userIdCodable.value as? String,
              let accountPool = accountPoolCodable.value as? String,
              let name = nameCodable.value as? String,
              let givenName = givenNameCodable.value as? String,
              let homeRegion = homeRegionCodable.value as? String else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Failed to extract string values from AnyCodable"
                )
            )
        }
        
        self.userId = userId
        self.accountPool = accountPool
        self.name = name
        self.givenName = givenName
        self.homeRegion = homeRegion
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        
        try container.encode(AnyCodable(userId), forKey: .userId)
        try container.encode(AnyCodable(accountPool), forKey: .accountPool)
        try container.encode(AnyCodable(name), forKey: .name)
        try container.encode(AnyCodable(givenName), forKey: .givenName)
        try container.encode(AnyCodable(homeRegion), forKey: .homeRegion)
    }
}

struct AAXAuthData: Codable {
    let adpToken: String
    let devicePrivateKey: String
    let accessToken: String
    let refreshToken: String
    let expires: TimeInterval
    let localeCode: String?
    let websiteCookies: [String: String]?
    let storeAuthenticationCookie: [String: AnyCodable]?
    let deviceInfo: [String: AnyCodable]
    let customerInfo: AAXCustomerInfo  // Changed this to use the proper struct
    
    enum CodingKeys: String, CodingKey {
        case adpToken = "adp_token"
        case devicePrivateKey = "device_private_key"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expires
        case localeCode = "locale_code"
        case websiteCookies = "website_cookies"
        case storeAuthenticationCookie = "store_authentication_cookie"
        case deviceInfo = "device_info"
        case customerInfo = "customer_info"
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        adpToken = try container.decode(String.self, forKey: .adpToken)
        devicePrivateKey = try container.decode(String.self, forKey: .devicePrivateKey)
        accessToken = try container.decode(String.self, forKey: .accessToken)
        refreshToken = try container.decode(String.self, forKey: .refreshToken)
        expires = try container.decode(TimeInterval.self, forKey: .expires)
        localeCode = try container.decodeIfPresent(String.self, forKey: .localeCode) ?? "uk"
        websiteCookies = try container.decodeIfPresent([String: String].self, forKey: .websiteCookies)
        storeAuthenticationCookie = try container.decodeIfPresent([String: AnyCodable].self, forKey: .storeAuthenticationCookie)
        deviceInfo = try container.decode([String: AnyCodable].self, forKey: .deviceInfo)
        customerInfo = try container.decode(AAXCustomerInfo.self, forKey: .customerInfo)  // Direct decoding
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        
        try container.encode(adpToken, forKey: .adpToken)
        try container.encode(devicePrivateKey, forKey: .devicePrivateKey)
        try container.encode(accessToken, forKey: .accessToken)
        try container.encode(refreshToken, forKey: .refreshToken)
        try container.encode(expires, forKey: .expires)
        try container.encode(localeCode ?? "us", forKey: .localeCode)
        try container.encodeIfPresent(websiteCookies, forKey: .websiteCookies)
        try container.encodeIfPresent(storeAuthenticationCookie, forKey: .storeAuthenticationCookie)
        try container.encode(deviceInfo, forKey: .deviceInfo)
        try container.encode(customerInfo, forKey: .customerInfo)
    }
}

extension AAXAuthData {
    func updateDataOnRemote(
        aaxAuthData: AAXAuthData
    ) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let path = "users/" + userID + "/aaxAuthData/"
        
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(
                to: path,
                value: aaxAuthData
            )
        }
    }
    
    func deleteDataOnRemote() {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let path = "users/" + userID + "/aaxAuthData/"
        
        DispatchQueue.global(qos: .background).async {
            Task {
                do {
                    try await RTDBManager.shared.deleteData(at: path)
                } catch {
                    print("error deleting aaxAuthData")
                }
            }
        }
    }
}
