//
//  Constants.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

struct Constants {    
    static var cloudFunctionRegion: String {
        return Bundle.main.object(forInfoDictionaryKey: "APP_CLOUD_FUNC_REGION") as? String ?? ""
    }
    
    static var rtdbURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_RTDB_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var privatePolicyURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_PRIVATE_POLICY_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var termsOfServiceURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_TERMS_OF_SERVICE_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var rateAppURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_RATE_US_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var shareAppURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_SHARE_WITH_FRIENDS_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var supportEmail: String {
        return Bundle.main.object(forInfoDictionaryKey: "APP_SUPPORT_EMAIL") as? String ?? ""
    }
    
    static var posthogAPiKey: String {
        return Bundle.main.object(forInfoDictionaryKey: "POSTHOG_API_KEY") as? String ?? ""
    }
    
    static var posthogHost: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "POSTHOG_HOST") as? String ?? ""
        return "https://" + url
    }
    
    static var discordServerURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "APP_DISCORD_SERVER_URL") as? String ?? ""
        return "https://" + url
    }
    
    static var mixpanelToken: String {
        return Bundle.main.object(forInfoDictionaryKey: "MIXPANEL_TOKEN") as? String ?? ""
    }
    
    static var mixpanelServerURL: String {
        let url = Bundle.main.object(forInfoDictionaryKey: "MIXPANEL_SERVER_URL") as? String ?? ""
        return "https://" + url
    }
}
