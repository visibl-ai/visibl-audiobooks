//
//  StylePickerCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct StylePickerCell: View {
    var title: String
    var prompt: String
    var isSelected: Bool
    var isUserDefault: Bool
    
    var action: () -> Void
    
    var body: some View {
        ZStack (alignment: .center) {
            if #available(iOS 26.0, *) {
                RoundedRectangle(cornerRadius: 12)
                    .cornerRadius(12)
                    .glassEffect(in: .rect(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(isSelected ? Color.customIndigo.gradient : Color.gray.gradient, lineWidth: isSelected ? 1.4 : 0.5)
                    )
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.ultraThinMaterial)
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(isSelected ? Color.customIndigo.gradient : Color.gray.gradient, lineWidth: isSelected ? 1.4 : 0.5)
                    )
            }
            
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                if prompt != "" {
                    Text(prompt)
                        .font(.system(size: 14, weight: .regular, design: .monospaced))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(2)
                }
            }
            .padding(16)
            
            if isUserDefault {
                VStack {
                    Text("Default")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(height: 24)
                        .padding(.horizontal, 8)
                        .background(.black, in: .rect(cornerRadius: 6))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    
                    Spacer()
                }
                .padding(8)
            }
        }
        .frame(width: 220, height: 130)
        .onTapGesture {
            if !isSelected {
                action()
            }
        }
    }
}
