//
//  MyLibraryFilterButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct MyLibraryFilterButton: View {
    let option: MyLibraryFilterOption
    var isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Text(option.title)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(
                isSelected ? .customWhite : .customBlack)
            .frame(height: 36)
            .padding(.horizontal, 16)
            .background {
                if isSelected {
                    if #available(iOS 26.0, *) {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.customBlack.gradient)
                            .glassEffect(.clear, in: .rect(cornerRadius: 12))
                            .shadow(color: .clear, radius: 0)
                    } else {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.customBlack.gradient)
                    }
                } else {
                    if #available(iOS 26.0, *) {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.customGray6)
                            .glassEffect(.clear, in: .rect(cornerRadius: 12))
                            .shadow(color: .clear, radius: 0)
                    } else {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.customGray6)
                    }
                }
            }
            .onTapGesture {
                if !isSelected {
                    action()
                }
            }
    }
}
