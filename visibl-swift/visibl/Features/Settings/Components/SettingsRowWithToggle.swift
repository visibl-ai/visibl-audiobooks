//
//  SettingsRowWithToggle.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct SettingsRowWithToggle: View {
    let icon: String
    let title: String
    @Binding var isEnabled: Bool
    
    var body: some View {
        HStack (spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 28, height: 28)
                .background(.black)
                .cornerRadius(6)
            
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(1)
                        
            Toggle("", isOn: $isEnabled)
                .toggleStyle(SwitchToggleStyle(tint: .customIndigo))
                .frame(width: 44)
                .padding(.trailing, 12)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }
}
