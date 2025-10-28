//
//  EmailTextField.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct EmailTextField: View {
    @Binding var email: String
    @Environment(\.colorScheme) var colorScheme
    
    var body: some View {
        HStack (spacing: 8) {
            Image(systemName: "at")
                .foregroundStyle(.gray)
            
            TextField("", text: $email, prompt: Text("email_placeholder".localized).foregroundColor(.gray))
                .foregroundStyle(.customBlack)
                .multilineTextAlignment(.leading)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
        }
        .padding(.horizontal, 12)
        .frame(height: 50)
        .background(colorScheme == .light ? Color(.systemGray6) : .black, in: .rect(cornerRadius: 12))
    }
}
