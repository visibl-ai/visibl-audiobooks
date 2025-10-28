//
//  AppAppearanceSelection.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

enum AppAppearance: String, Codable, CaseIterable, Identifiable {
    case system, light, dark
    
    var id: String { self.rawValue }
    
    var localizedName: String {
        return self.rawValue.localized
    }
}

struct AppAppearanceSelection: View {
    @Environment(\.dismiss) var dismiss
    @ObservedObject var userConfigurations = UserConfigurations.shared
    
    init() {
        UINavigationBar.appearance().titleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 18, weight: .semibold).withSerifDesign()
        ]
    }
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(AppAppearance.allCases) { appearance in
                    Button(action: {
                        userConfigurations.selectedAppearance = appearance
                        updateAppAppearance()
                        dismiss()
                    }, label: {
                        HStack {
                            Text(appearance.localizedName)
                                .font(.system(size: 14, weight: .regular))
                            
                            Spacer()
                            
                            if userConfigurations.selectedAppearance == appearance {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.customBlack)
                            }
                        }
                    })
                }
            }
            .listStyle(.plain)
            .navigationBarTitle("select_appearance_title".localized, displayMode: .inline)
            .navigationBarItems(
                trailing: DoneButton {
                    dismiss()
                }
            )
        }
    }
    
    func updateAppAppearance() {
        DispatchQueue.main.async {
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let window = windowScene.windows.first {
                switch self.userConfigurations.selectedAppearance {
                case .light:
                    window.overrideUserInterfaceStyle = .light
                case .dark:
                    window.overrideUserInterfaceStyle = .dark
                case .system:
                    window.overrideUserInterfaceStyle = .unspecified
                }
            }
        }
    }
}
