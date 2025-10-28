//
//  CatalogueGridCell.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct CatalogueGridCell: View {
    let publication: PublicationModel
    let action: () -> Void
    
    var body: some View {
        VStack(alignment: .center, spacing: 12) {
            if let url = URL(string: publication.coverArtUrl) {
                Color.gray
                    .frame(height: 170)
                    .frame(maxWidth: .infinity)
                    .clipShape(.rect(cornerRadius: 6))
                    .overlay {
                        KFImage(url)
                            .resizable()
                            .placeholder { placeholder }
                            .fade(duration: 0.8)
                            .aspectRatio(contentMode: .fill)
                    }
                    .clipShape(.rect(cornerRadius: 6))
                    .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
            } else {
                placeholder
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(publication.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                
                if !publication.availableAuthors.isEmpty {
                    Text(publication.availableAuthors.joined(separator: ", "))
                        .font(.system(size: 13, weight: .regular))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .padding(.bottom, 16)
        }
        .frame(width: 170)
        .overlay(alignment: .topLeading) {
            importedBadge
        }
        .onTapGesture {
            action()
        }
    }
    
    private var placeholder: some View {
        Rectangle()
            .fill(Color(UIColor.systemGray4))
            .aspectRatio(1, contentMode: .fit)
            .cornerRadius(6)
            .shimmerEffect()
    }
    
    private var importedBadge: some View {
        Text("catalogue_source_type_aac".localized)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.vertical, 4)
            .padding(.horizontal, 8)
            .background(.customIndigo.gradient, in: .capsule)
            .padding(8)
            .opacity(publication.visibility == .private ? 1 : 0)
    }
}
