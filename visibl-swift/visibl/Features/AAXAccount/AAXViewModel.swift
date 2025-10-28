//
//  AAXViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import SwiftUI

@MainActor
final class AAXViewModel: ObservableObject {
    private var aaxClient: AAXClientWrapper
    let onSuccess: (() -> Void)?
    
    @Published var isAccessibilityAccepted: Bool = false
    @Published var selectedCountryCode: AAXCountry = .unitedKingdom
    @Published var currentURL: URL?
    @Published var isLoading: Bool = false
    
    private var rConfig = RemoteConfiguration.shared
    
    var aaxProviderName: String {
        rConfig.aaxProvider?.name ?? "aax_profile_no_user_name_available".localized
    }
    var aaxProviderCompany: String {
        rConfig.aaxProvider?.company ?? "aax_profile_no_user_name_available".localized
    }
    var aaxProviderLogo: String {
        rConfig.aaxProvider?.logo ?? ""
    }
    var aaxConsentURL: String {
        rConfig.aaxProvider?.consentURL ?? ""
    }

    init(
        aaxClient: AAXClientWrapper,
        onSuccess: (() -> Void)? = nil
    ) {
        self.aaxClient = aaxClient
        self.onSuccess = onSuccess
    }
    
    func requestAuth() async {
        do {
            let authURL = try await aaxClient.requestAuth(countryCode: selectedCountryCode)
            currentURL = URL(string: authURL)!
        } catch {
            print("Error getting login page: \(error.localizedDescription)")
        }
    }
    
    func completeAuth(redirectURL: String) async throws {
        do {
            isLoading = true
            try await aaxClient.completeAuth(redirectURL: redirectURL)
        } catch {
            isLoading = false
            Toastify.show(style: .error, message: error.localizedDescription)
            throw error
        }
    }
}
