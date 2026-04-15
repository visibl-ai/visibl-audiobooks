//
//  DownloadButton.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct DownloadButton: View {
    let isLoading: Bool
    let isAdded: Bool
    let isAAXPublication: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                        .tint(.white)
                } else {
                    Image(systemName: isAdded ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(.white)
                }

                if isAdded {
                    Text("already_added_btn".localized)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                } else {
                    Text(isAAXPublication ? "download_aaxtitle_btn".localized : "get_this_book_btn".localized)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isAdded ? Color(.systemGray4).gradient : Color.customIndigo.gradient)
                        .glassEffect(in: .rect(cornerRadius: 12))
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isAdded ? Color(.systemGray4).gradient : Color.customIndigo.gradient)
                }
            }
        }
        .padding(.bottom, 14)
        .padding(.horizontal, 14)
        .disabled(isAdded)
    }
}
