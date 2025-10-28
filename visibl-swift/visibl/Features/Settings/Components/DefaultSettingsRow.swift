//
//  DefaultSettingsRow.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct DefaultSettingsRow: View {
    let icon: String
    let title: String
    let iconSize: CGFloat
    let iconContainerSize: CGFloat
    let selectedValue: String?
    let isSystemIcon: Bool

    let action: () -> Void

    init(
        systemIcon: String,
        title: String,
        iconSize: CGFloat = 14,
        iconContainerSize: CGFloat = 28,
        selectedValue: String? = nil,
        action: @escaping () -> Void
    ) {
        self.icon = systemIcon
        self.title = title
        self.iconSize = iconSize
        self.iconContainerSize = iconContainerSize
        self.selectedValue = selectedValue
        self.isSystemIcon = true
        self.action = action
    }

    init(
        customIcon: String,
        title: String,
        iconSize: CGFloat = 14,
        iconContainerSize: CGFloat = 28,
        selectedValue: String? = nil,
        action: @escaping () -> Void
    ) {
        self.icon = customIcon
        self.title = title
        self.iconSize = iconSize
        self.iconContainerSize = iconContainerSize
        self.selectedValue = selectedValue
        self.isSystemIcon = false
        self.action = action
    }

    var body: some View {
        Button(action: action, label: {
            HStack (spacing: 12) {
                Group {
                    if isSystemIcon {
                        Image(systemName: icon)
                            .font(.system(size: iconSize, weight: .bold))
                    } else {
                        Image(icon)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: iconSize, height: iconSize)
                    }
                }
                .foregroundColor(.white)
                .frame(width: iconContainerSize, height: iconContainerSize)
                .background(.black)
                .cornerRadius(6)
                
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                
                if let text = selectedValue {
                    Text(text)
                        .font(.system(size: 14, weight: .light))
                        .foregroundColor(.gray)
                        .padding(.leading, 6)
                }
                
                Image(systemName: "chevron.right")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 12, height: 12)
                    .foregroundColor(.gray)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
        })
    }
}
