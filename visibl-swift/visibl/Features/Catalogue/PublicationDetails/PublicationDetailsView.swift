//
//  PublicationDetailsView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct PublicationDetailsView: View {
    @State private var viewModel: PublicationDetailsViewModel

    init(
        coordinator: Coordinator,
        diContainer: DIContainer,
        publication: PublicationPreviewModel
    ) {
        self.viewModel = .init(
            coordinator: coordinator,
            diContainer: diContainer,
            publication: publication
        )
    }

    var body: some View {
        ScrollView (.vertical, showsIndicators: false) {
            ParallaxHeaderView(publication: viewModel.publication)

            VStack (spacing: 20) {
                publicationInfo
                description
            }
            .padding(.vertical, 16)
        }
        .navigationBarHidden(true)
        .safeAreaInset(edge: .top) {
            customNavbarView
        }
        .safeAreaInset(edge: .bottom) {
            downloadButton
        }
        .confirmationDialog(
            "",
            isPresented: $viewModel.isActionSheetPresented,
            titleVisibility: .visible
        ) {
            Button("report_a_problem_btn".localized) {
                viewModel.handleReportProblem()
            }
        }
        .trackScreenView(
            "Book Details",
            properties: viewModel.screenTrackingProperties
        )
    }

    private var customNavbarView: some View {
        HStack {
            NavbarButton(
                icon: "chevron.backward",
                action: viewModel.navigateBack
            )

            Spacer()

            NavbarButton(
                icon: "ellipsis",
                action: viewModel.presentActionSheet
            )
        }
        .padding(.horizontal, 16)
    }

    private var publicationInfo: some View {
        PublicationInfoSection(
            year: viewModel.publication.year,
            duration: viewModel.publication.duration,
            chaptersCount: viewModel.publication.chaptersCount
        )
    }

    private var description: some View {
        PublicationDescriptionSection(description: viewModel.publication.description)
    }

    // MARK: - Download Button

    private var downloadButton: some View {
        DownloadButton(
            isLoading: viewModel.isLoading,
            isAdded: viewModel.isAdded,
            isAAXPublication: viewModel.isAAXPublication,
            action: viewModel.handleAddBookTap
        )
    }
}
