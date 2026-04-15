//
//  PublicationDescriptionSection.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PublicationDescriptionSection: View {
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("book_summary_title".localized)
                .font(.system(size: 20, weight: .bold, design: .serif))
                .foregroundStyle(.customBlack)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(1)

            Text(description)
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }
}
