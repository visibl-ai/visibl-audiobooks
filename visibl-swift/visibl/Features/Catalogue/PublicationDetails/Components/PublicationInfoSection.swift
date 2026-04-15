//
//  PublicationInfoSection.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PublicationInfoSection: View {
    let year: String?
    let duration: String?
    let chaptersCount: String?

    var body: some View {
        HStack(spacing: 12) {
            if let year {
                PublicationInfoCell(
                    icon: "calendar",
                    title: year,
                    subtitle: "released_title".localized
                )
            }

            if let duration {
                PublicationInfoCell(
                    icon: "clock",
                    title: duration,
                    subtitle: "duration_title".localized
                )
            }

            if let chaptersCount {
                PublicationInfoCell(
                    icon: "book.closed",
                    title: chaptersCount,
                    subtitle: "chapters_title".localized
                )
            }
        }
        .padding(.horizontal, 16)
    }
}
