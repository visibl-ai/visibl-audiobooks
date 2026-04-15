//
//  ImportView.swift
//

import SwiftUI

struct ImportView: View {
    @State private var viewModel: ImportViewModel

    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.viewModel = .init(
            coordinator: coordinator,
            diContainer: diContainer
        )
    }
    
    var body: some View {
        VStack(spacing: 18) {
            titleView
            importOptions
        }
        .padding(.top, 58)
        .padding(.bottom, 32)
        .presentationCornerRadius(40)
        .presentationDragIndicator(.visible)
        .presentationDetents([.height(viewModel.isAAXconnected ? 332 : 394)])
        .fileImporter(
            isPresented: $viewModel.isFilePickerPresented,
            allowedContentTypes: ImportViewModel.allowedContentTypes,
            onCompletion: viewModel.handleFileImportResult
        )
    }
    
    private var titleView: some View {
        VStack(spacing: 10) {
            Text("import_title".localized)
                .font(.system(size: 18, weight: .bold))
            Text("import_subtitle".localized)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(.gray)
                .frame(maxWidth: .infinity, alignment: .center)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
    
    var importOptions: some View {
        LazyVStack(spacing: 10) {
            ForEach(ImportOption.allCases) { option in
                ImportCell(
                    option: option,
                    isHidden: viewModel.isHidden(for: option)
                ) {
                    switch option {
                    case .aax: viewModel.presentAAXconnect()
                    case .fromFile: viewModel.presentFilePicker()
                    case .fromLink: viewModel.presentLinkAddAlert()
                    }
                }
            }
        }
        .padding(.horizontal, 20)
    }
}
