//
//  CustomSegmentedControl.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct CustomSegmentedControl<T: CaseIterable & Hashable & Identifiable>: View where T: CustomStringConvertible {
    @Binding var selectedValue: T
    @Namespace private var animation

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(T.allCases), id: \.self) { value in
                ZStack {
                    if selectedValue == value {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(
                                LinearGradient(
                                    colors: [.customBlack, .customBlack.opacity(0.7)],
                                    startPoint: .bottomLeading,
                                    endPoint: .topTrailing)
                            )
                            .matchedGeometryEffect(id: "background", in: animation)
                    }
                    
                    Text(value.description)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(selectedValue == value ? .customWhite : .customBlack)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.black.opacity(0.0001))
                }
                .onTapGesture {
                    HapticFeedback.shared.trigger(style: .light)
                    
                    withAnimation(.easeInOut(duration: 0.275)) {
                        selectedValue = value
                    }
                }
            }
        }
        .frame(height: 36)
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}
