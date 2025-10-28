//
//  VideoShareProgress.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct VideoShareProgressView: View {
    @ObservedObject var progressState: VideoShareProgress
    
    var body: some View {
        VStack {
            VStack (spacing: 16) {
//                Text(progressState.message)
//                    .font(.system(size: 20, weight: .semibold))
//                    .foregroundStyle(.white)
                VStack (spacing: 8) {
                    Text("video_share_loader_title".localized)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("video_share_loader_message".localized)
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                }
                
                // Progress bar
                HStack(spacing: 0) {
                    // Progress percentage
                    Text("\(Int(progressState.progress * 100))%")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)
                        .frame(width: 38, alignment: .center)
                    
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            // Background track
                            RoundedRectangle(cornerRadius: 4)
                                .fill(.gray.opacity(0.2))
                                .frame(height: 8)
                            
                            // Progress fill
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
                    Text("Cancel")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.customIndigo)
                }
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 24)
            .background(.ultraThinMaterial, in: .rect(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).stroke(.gray.opacity(0.3), lineWidth: 1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.6))
        .preferredColorScheme(.dark)
    }
}
