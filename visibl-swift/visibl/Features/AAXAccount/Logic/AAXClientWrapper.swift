//
//  AAXClientWrapper.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import AAXConnectSwift
import AAXCPlayer
import Combine

final class AAXClientWrapper: ObservableObject {
    private let aaxAuthDataObserver: AAXAuthDataObserver
    private let authService: AuthServiceProtocol
    
    @Published var aaxAuthData: AAXAuthData?
    @Published var currentClient: AAXConnectClient?
    @Published var isAuthenticated: Bool = false
    
    var userName: String {
        aaxAuthData?.customerInfo.name ?? "aax_profile_no_user_name_available".localized
    }
    
    private var cancellables = Set<AnyCancellable>()
    
    init(
        aaxAuthDataObserver: AAXAuthDataObserver,
        authService: AuthServiceProtocol
    ) {
        self.aaxAuthDataObserver = aaxAuthDataObserver
        self.authService = authService
        bind()
    }
    
    private func bind() {
        aaxAuthDataObserver.$aaxAuthData
            .receive(on: DispatchQueue.main)
            .sink { [weak self] authData in
                self?.aaxAuthData = authData
                self?.checkAuthenticationStatus()
            }
            .store(in: &cancellables)
    }
    
    private func saveAuthData(_ data: Data) async {
        do {
            let decodedData: AAXAuthData = try JSONDecoder().decode(AAXAuthData.self, from: data)
            decodedData.updateDataOnRemote(aaxAuthData: decodedData)
        } catch {
            print("Error saving auth data: \(error)")
        }
    }
    
    // MARK: - Authentication Status Check
    
    func checkAuthenticationStatus() {
        let hasAuthData = aaxAuthData != nil
        isAuthenticated = hasAuthData
        
        if isAuthenticated {
            Task {
                try await setupClient()
            }
        } else {
            currentClient = nil
        }
    }
    
    // MARK: - Initial Auth Request
    
    func requestAuth(countryCode: AAXCountry) async throws -> String {
        let authRequest = try AAXConnectAuth.requestAuth(countryCode: countryCode.requestString)
        return authRequest.authURL
    }
    
    // MARK: - Complete Authentication (Redirect from Webview) + Saving Auth Data

    func completeAuth(redirectURL: String) async throws {
        guard redirectURL.contains("openid.oa2.authorization_code") else {
            throw AAXAuthError.authenticationFailed
        }
        
        let client = try await AAXConnectAuth.completeAuth(redirectURL: redirectURL)
        let authData = try client.exportAuthSessionToJSON()
        try await saveAAXUserInfo(authData: authData)
    }
    
    // MARK: - Save Auth Data
    
    @MainActor
    private func saveAAXUserInfo(authData: Data) async throws {
        // print("AAXClientWrapper: Saving AAX user info")
        
        let decodedAuthData = try JSONDecoder().decode(AAXAuthData.self, from: authData)
        // print("AAXClientWrapper: Successfully decoded auth data \(decodedAuthData)")
        
        let result = try await AAXService.connectAAX(aaxUserId: decodedAuthData.customerInfo.userId)
        
        if result.success == false {
            print("Not possible to connect to AAX, account is already connected to another Visibl account")
            throw AAXAuthError.accountIsLinkedToAnotherUser
        }
        
        aaxAuthData = decodedAuthData
        isAuthenticated = true
        
        try await setupClient()
    }
    
    // MARK: - Setup Client
    
    @MainActor
    func setupClient() async throws {
        guard let aaxAuthData = aaxAuthData else {
            print("AAXClientWrapper: No auth data available for client setup")
            return
        }
        
        // print("AAXClientWrapper: Setting up client with auth data")
        
        do {
            let authDataAsData = try JSONEncoder().encode(aaxAuthData)
            let client = try AAXConnectClient(fromSavedAuthJSON: authDataAsData)
            
            await MainActor.run {
                self.currentClient = client
                self.isAuthenticated = true
            }
            
            // print("AAXClientWrapper: Client successfully created and authenticated")
            
            try await refreshLibrary()
            
            await saveAuthData(authDataAsData)
        } catch {
            print("AAXClientWrapper: Error initializing client: \(error.localizedDescription)")
            await MainActor.run {
                self.currentClient = nil
                self.isAuthenticated = false
            }
        }
    }
    
    // MARK: - Submit Library to Server
    
    private func refreshLibrary() async throws {
        guard let client = currentClient else { throw AAXAuthError.clientNotInitialized }
        let library = try await client.loadLibrary()
        let libraryData = try client.exportLibraryToJSON(library: library)
        let jsonObject = try JSONSerialization.jsonObject(with: libraryData, options: [])
        // print("submitted library")
        // print(jsonObject)
        try await AAXService.submitLibrary(libraryData: jsonObject)
    }
    
    // MARK: - Disconnect AAX Account
    
    @MainActor
    func disconnect() async {
        guard let userUID = authService.getUserID() else {
            print("No user ID available to inform server of disconnect")
            return
        }
        print("AAXClientWrapper: Signing out - clearing auth data")
        aaxAuthData?.deleteDataOnRemote()
        do {
            try await AAXService.disconnectAAX(userId: userUID)
        } catch {
            print(error.localizedDescription)
        }
        aaxAuthData = nil
        currentClient = nil
        isAuthenticated = false
    }
}

// MARK: - Common License Processing

extension AAXClientWrapper {
    
    /// Common method to get license response and voucher for a book
    private func getLicenseAndVoucher(for id: String) async throws -> (licenseResponse: [String: Any], voucher: AAXConnectCrypto.DecryptedVoucher) {
        guard let currentClient else {
            throw AAXConnectError.registrationFailed("Not logged in")
        }
        
        guard let aaxAuthData2 = aaxAuthData else {
            throw AAXConnectError.registrationFailed("No auth data available")
        }
        
        guard let asin = try await currentClient.getASINForSKU(skuLite: id) else {
            throw AAXConnectError.registrationFailed("Book not found")
        }
        
        let licenseResponse = try await currentClient.getLicenseResponse(asin: asin, quality: "High")
        
        // Convert AAXCustomerInfo back to dictionary format
        let customerInfoDict: [String: Any] = [
            "user_id": aaxAuthData2.customerInfo.userId,
            "account_pool": aaxAuthData2.customerInfo.accountPool,
            "name": aaxAuthData2.customerInfo.name,
            "given_name": aaxAuthData2.customerInfo.givenName,
            "home_region": aaxAuthData2.customerInfo.homeRegion
        ]
        
        let voucher = try AAXConnectCrypto.decryptVoucherFromLicenseRequest(
            deviceInfo: aaxAuthData2.deviceInfo.mapValues { $0.value },
            customerInfo: customerInfoDict,
            licenseResponse: licenseResponse
        )
        
        return (licenseResponse: licenseResponse, voucher: voucher)
    }
}

// MARK: - Download Related Methods

extension AAXClientWrapper {
    func submitMetadata(id: String, aaxFilePath: String, keyHex: String, ivHex: String) async throws {
        // Convert hex to Data
        guard let key = Data(hexString: keyHex), let iv = Data(hexString: ivHex) else {
            throw NSError(domain: "Invalid hex format", code: 400)
        }
        
        // Get the actual file size
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: aaxFilePath)
        let fileSize = fileAttributes[.size] as? Int ?? 0
        
        // Extract metadata
        let player = try AAXCSelectivePlayer(key: key, iv: iv, inputPath: aaxFilePath)
        
        let metadata = try player.parseMetadata()
        let metadataJSON = metadata.toJSON(fileSize: fileSize)
        
        try await AAXService.submitMetadata(sku: id, metadata: metadataJSON)
    }
    
    func getAAXDownloadInfo(id: String) async throws -> (url: String, key: String, iv: String) {
        let (licenseResponse, voucher) = try await getLicenseAndVoucher(for: id)
        
        guard let contentLicense = licenseResponse["content_license"] as? [String: Any],
              let contentMetadata = contentLicense["content_metadata"] as? [String: Any],
              let contentURL = contentMetadata["content_url"] as? [String: Any],
              let offlineURL = contentURL["offline_url"] as? String else {
            throw AAXConnectError.decryptionFailed("Missing download URL")
        }
        
        return (url: offlineURL, key: voucher.key, iv: voucher.iv)
    }
}

// MARK: - Validation Methods

extension AAXClientWrapper {
    func validateVoucher(id: String) async throws -> Bool {
        let (licenseResponse, voucher) = try await getLicenseAndVoucher(for: id)
        
        // Create LicenseInfo using manual struct creation
        let licenseInfoDict: [String: Any] = [
            "content_license": licenseResponse,
            "voucher": [
                "key": voucher.key,
                "iv": voucher.iv,
                "asin": voucher.asin ?? "",
                "rules": voucher.rules ?? []
            ]
        ]
        
        // Convert to JSON and back to create proper LicenseInfo
        let jsonData = try JSONSerialization.data(withJSONObject: licenseInfoDict)
        let licenseInfo = try JSONDecoder().decode(LicenseInfo.self, from: jsonData)
        
        // Use the correct method signature and return only the boolean
        let result = AAXConnectClient.validateVoucher(licenseInfo: licenseInfo)
        return result.isValid
    }
}
