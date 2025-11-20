//
//  LoadingPlaceholder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct LoadingPlaceholder: View {
    var body: some View {
        VStack {
            Spacer()
            VStack {
                ProgressView()
                Text("loding_title".localized)
                    .font(.system(size: 14, weight: .light))
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
