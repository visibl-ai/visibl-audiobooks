//
//  NetworkManager.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Network
import UIKit

public enum NetworkStatus: String {
    case connected
    case disconnected
}

public enum NetworkType: String {
    case wifi
    case cellular
    case wiredEthernet
    case other
}

@MainActor
public class NetworkManager: ObservableObject {
    public static let shared = NetworkManager()
    
    @Published public var isMonitoring = false
    @Published public var status: NetworkStatus = .disconnected
    @Published private var pathStatus = NWPath.Status.requiresConnection
    @Published public var isConnected = false
        
    var monitor: NWPathMonitor?
    
    private var isStatusSatisfied: Bool {
        guard let monitor = monitor else { return false }
        return monitor.currentPath.status == .satisfied
    }
    
    public var networkType: NetworkType? {
        guard let monitor = monitor else { return nil }
        let type = monitor.currentPath.availableInterfaces.first {
            monitor.currentPath.usesInterfaceType($0.type)
        }?.type
        return getNetworkType(interFaceType: type)
    }
    
    private var availableNetworkTypes: [NWInterface.InterfaceType]? {
        guard let monitor = monitor else { return nil }
        return monitor.currentPath.availableInterfaces.map { $0.type }
    }
    
    public func startMonitoring() {
        print("Starting Network Monitoring")
        
        guard !isMonitoring else { return }
        
        monitor = NWPathMonitor()
        let queue = DispatchQueue(label: "NetworkStatus_Monitor")
        monitor?.start(queue: queue)
        monitor?.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self = self else { return }
                if self.pathStatus != path.status {
                    self.pathStatus = path.status
                    self.status = (self.pathStatus == .satisfied) ? .connected : .disconnected
                    self.isConnected = (self.status == .connected)
                    if self.status == .disconnected {
                        self.presentNetworkAlert()
                    }
                }
            }
        }
        
        isMonitoring = true
    }
    
    public func stopMonitoring() {
        guard isMonitoring, let monitor = monitor else { return }
        monitor.cancel()
        self.monitor = nil
        isMonitoring = false
    }
    
    private func getNetworkType(interFaceType: NWInterface.InterfaceType?) -> NetworkType {
        switch interFaceType {
        case .wifi:
            return .wifi
        case .cellular:
            return .cellular
        case .wiredEthernet:
            return .wiredEthernet
        default:
            return .other
        }
    }
    
    public func presentNetworkAlert() {
        let alertController = UIAlertController(
            title: "No Internet Connection",
            message: "Your internet connection appears to be offline. Would you like to open Settings to check your connection?",
            preferredStyle: .alert
        )
        
        alertController.addAction(UIAlertAction(title: "Cancel", style: .cancel, handler: nil))
        alertController.addAction(UIAlertAction(title: "Settings", style: .default, handler: { _ in
            if let url = URL(string: UIApplication.openSettingsURLString),
               UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }))
        
        if let topVC = UIWindowScene.topMostViewController() {
            topVC.present(alertController, animated: true)
        }
    }
}
