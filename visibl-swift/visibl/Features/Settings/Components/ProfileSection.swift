//
//  ProfileSection.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import FirebaseAuth

struct ProfileSection: View {
    @ObservedObject var userConfigurations = UserConfigurations.shared
    let action: () -> Void
    
    var body: some View {
        HStack (spacing: 8) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 38))
                .foregroundColor(.white)

            VStack (spacing: 2) {
                Text("account_title".localized)
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                if let userEmal = Auth.auth().currentUser?.email {
                    Text(userEmal)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(1)
                } else {
                    Text("sign_up_call_to_action".localized)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(1)
                }
            }
            
            Image(systemName: "chevron.right")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(.white)
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 12)
        .background {
            if #available(iOS 26.0, *) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.customIndigo.gradient)
                    .glassEffect(in: .rect(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.customIndigo.gradient)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .onTapGesture {
            action()
        }
    }
}
