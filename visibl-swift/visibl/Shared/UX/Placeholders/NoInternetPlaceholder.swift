//
//  NoInternetPlaceholder.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct NoInternetPlaceholder: View {
    var body: some View {
        VStack {
            Spacer()
            
            VStack {
                Image(systemName: "wifi.slash")
                    .foregroundStyle(.gray)
                Text("no_internet_placeholder_title".localized)
                    .font(.system(size: 14, weight: .light))
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
