//
//  UploadProgressView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct UploadProgressView: View {
    @ObservedObject var progressState: UploadProgress

    var body: some View {
        VStack {
            VStack(spacing: 16) {
                Text("import_upload_title".localized)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.customBlack)

                HStack(spacing: 0) {
                    Text("\(Int(progressState.progress * 100))%")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)
                        .frame(width: 38, alignment: .center)

                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(.gray.opacity(0.2))
                                .frame(height: 8)

                            RoundedRectangle(cornerRadius: 4)
                                .fill(.customIndigo.gradient)
                                .frame(width: geometry.size.width * progressState.progress, height: 8)
                                .animation(.linear(duration: 0.3), value: progressState.progress)
                        }
                    }
                    .frame(height: 8)
                    .padding(.horizontal, 4)
                }
                .frame(maxWidth: 242)

                Button(action: {
                    progressState.cancel()
                }) {
                    Text("cancel_button".localized)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.customIndigo)
                }
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 24)
            .background(.customWhite, in: .rect(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).stroke(.gray.opacity(0.3), lineWidth: 1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.6))
        .preferredColorScheme(.dark)
    }
}
