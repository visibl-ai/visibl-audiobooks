//
//  AAXBannerView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct AAXBannerView: View {
    let action: () -> Void
    
    var body: some View {
        HStack (spacing: 18) {
            VStack (spacing: 4) {
                Text("catalogue_aax_connect_title".localized)
                    .font(.system(size: 18, weight: .bold, design: .serif))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("catalogue_aax_connect_subtitle".localized)
                    .font(.system(size: 12, weight: .light))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            Button(action: action) {
                Text("catalogue_aax_connect_btn".localized)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .background(.black, in: .rect(cornerRadius: 10))
            }
        }
        .padding(.vertical, 18)
        .padding(.horizontal, 16)
        .background {
            if #available(iOS 26.0, *) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.clear)
                    .glassEffect(in: .rect(cornerRadius: 16))
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.regularMaterial)
                    .strokeBorder(.gray.gradient.opacity(0.24), lineWidth: 0.5)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 20)
    }
}
