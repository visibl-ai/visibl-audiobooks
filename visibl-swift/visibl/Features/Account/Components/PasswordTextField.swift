//
//  PasswordTextField.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct PasswordTextField: View {
    @Binding var password: String
    var placeholder: String = "password_placeholder".localized
    var isNewPassword: Bool
    @Environment(\.colorScheme) var colorScheme
    @State private var isPasswordVisible: Bool = false
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock")
                .foregroundStyle(.gray)
            
            if isPasswordVisible {
                TextField("", text: $password, prompt: Text(placeholder).foregroundColor(.gray))
                    .foregroundStyle(.customBlack)
                    .multilineTextAlignment(.leading)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textContentType(isNewPassword ? .newPassword : .password)
            } else {
                SecureField("", text: $password, prompt: Text(placeholder).foregroundColor(.gray))
                    .foregroundStyle(.customBlack)
                    .multilineTextAlignment(.leading)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textContentType(isNewPassword ? .newPassword : .password)
            }
            
            Button(action: {
                isPasswordVisible.toggle()
            }) {
                Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                    .foregroundStyle(.gray)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 50)
        .background(colorScheme == .light ? Color(.systemGray6) : .black, in: .rect(cornerRadius: 12))
    }
}
