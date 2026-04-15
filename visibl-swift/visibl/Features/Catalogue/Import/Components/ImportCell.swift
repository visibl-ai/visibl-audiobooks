//
//  ImportCell.swift
//

import SwiftUI

struct ImportCell: View {
    let option: ImportOption
    let isHidden: Bool
    let action: () -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        if !isHidden {
            HStack(spacing: 16) {
                Image(systemName: option.icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.customWhite)
                    .frame(width: 46, height: 46)
                    .background {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.customBlack)
                    }
                
                VStack(alignment: .leading, spacing: 3) {
                    Text(option.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.customBlack)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(option.subtitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.gray)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 16))
                    .foregroundStyle(.gray)
            }
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.regularMaterial)
                    .stroke(.gray.opacity(0.5), lineWidth: 0.5)
                    .shadow(
                        color: colorScheme == .light ? .gray.opacity(0.18) : .clear,
                        radius: 5, x: 0, y: 4
                    )
            }
            .onTapGesture {
                action()
            }
        }
    }
}

