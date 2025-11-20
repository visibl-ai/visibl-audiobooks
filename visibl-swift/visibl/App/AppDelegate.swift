//
//  AppDelegate.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import UIKit
import Firebase
import FirebaseRemoteConfig
import FirebaseMessaging
import UserNotificationsUI
import FirebaseAuth
import SDDownloadManager
import Mixpanel

class AppDelegate: NSObject, UIApplicationDelegate, MessagingDelegate, UNUserNotificationCenterDelegate {
    private let analytics = AnalyticsManager.shared
    
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil
    ) -> Bool {
        Mixpanel.initialize(token: Constants.mixpanelToken, trackAutomaticEvents: true)
        Mixpanel.mainInstance().serverURL = Constants.mixpanelServerURL
        #if DEBUG
        let providerFactory = AppCheckDebugProviderFactory()
        AppCheck.setAppCheckProviderFactory(providerFactory)
        #endif
        FirebaseApp.configure()
        setupRemoteConfig()
        setupNotifications()
        analytics.setup()
        return true
    }
    
    private func setupRemoteConfig() {
        let remoteConfig = RemoteConfig.remoteConfig()
        let settings = RemoteConfigSettings()
        settings.minimumFetchInterval = 0
        remoteConfig.configSettings = settings
        
        Task { @MainActor in
            do {
                try await remoteConfig.fetchAndActivate()
                
                RemoteConfiguration.shared.aaxProvider = try remoteConfig.configValue(forKey: "aaxProvider").decoded(asType: AAXProviderModel.self)
                RemoteConfiguration.shared.currentAppVersion = remoteConfig.configValue(forKey: "currentAppVersion").stringValue
                RemoteConfiguration.shared.newVersionURLString = remoteConfig.configValue(forKey: "newVersionURLString").stringValue
                checkAppVersion(
                    remoteAppVersion: RemoteConfiguration.shared.currentAppVersion,
                    newVersionURLString: RemoteConfiguration.shared.newVersionURLString
                )
            } catch {
                print("Config not fetched or decode failed: \(error.localizedDescription)")
                print("Detailed error: \(error)")
            }
        }
    }
    
    private func checkAppVersion(remoteAppVersion: String?, newVersionURLString: String?) {
        guard let localVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
              let remoteVersion = remoteAppVersion, !remoteVersion.isEmpty,
              let appStoreURL = newVersionURLString else {
            return
        }
        
        print("Local: \(localVersion) | Remote: \(remoteVersion)")
        
        if localVersion.compare(remoteVersion, options: .numeric) == .orderedAscending {
            print("⚠️ Update required")
            ForceUpdateOverlayView.show(appStoreURL: appStoreURL)
        }
    }
    
    private func setupNotifications() {
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        
        if !CommandLine.arguments.contains("--uitesting") { // disable notifications request for UI tests
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { success, _ in
                if success {
                    print("APNS authorization granted")
                }
            }
            
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }
    
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        debugPrint("handleEventsForBackgroundURLSession: \(identifier)")
        SDDownloadManager.shared.backgroundCompletionHandler = completionHandler
    }
}

extension AppDelegate {
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenParts = deviceToken.map { String(format: "%02.2hhx", $0) }
        let deviceTokenString = tokenParts.joined()
        
        print("APNS Device Token: \(deviceTokenString)")
        Messaging.messaging().apnsToken = deviceToken
        
        Messaging.messaging().token { token, error in
            if let error = error {
                print("FCM token fetch error: \(error.localizedDescription)")
            } else if let token = token {
                print("FCM Token: \(token)")
            }
        }
    }
    
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken else {
            print("FCM token is nil")
            return
        }
        
        updateFCMTokenOnRemote(fcmToken: fcmToken)
        NotificationCenter.default.post(name: Notification.Name("FCMToken"), object: nil, userInfo: ["token": fcmToken])
    }
    
    func applicationDidBecomeActive(_ application: UIApplication) {
        UNUserNotificationCenter.current().setBadgeCount(0) { error in
            if let error = error {
                print("Badge count reset error: \(error.localizedDescription)")
            }
        }
    }
    
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }
    
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        print("Notification received: \(response.notification.request.content.userInfo)")
        completionHandler()
    }
    
    private func updateFCMTokenOnRemote(fcmToken: String) {
        guard let userID = Auth.auth().currentUser?.uid else {
            print("FCM token update failed: No authenticated user")
            return
        }
        
        let path = "users/\(userID)/fcmToken"
        
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(to: path, value: fcmToken)
        }
    }
}
