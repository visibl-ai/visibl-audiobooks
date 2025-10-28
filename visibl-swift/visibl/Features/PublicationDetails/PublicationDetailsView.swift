//
//  PublicationDetailsView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct PublicationDetailsView: View {
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    @StateObject private var viewModel: PublicationDetailsViewModel
    @ObservedObject private var userConfig = UserConfigurations.shared
    @ObservedObject private var analytics: AnalyticsManager
    
    init(
        publication: PublicationModel,
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        _viewModel = StateObject(wrappedValue: PublicationDetailsViewModel(
            publication: publication,
            diContainer: diContainer
        ))
        self.analytics = .shared
    }
    
    var body: some View {
        ScrollView (.vertical, showsIndicators: false) {
            ParallaxHeaderView(
                height: viewModel.sheetHeight,
                coverURL: URL(string: viewModel.subscribedPublication.coverArtUrl)
            ) {
                bookInfo
            }
            
            VStack (spacing: 20) {
                publicationInfo
                description
            }
            .padding(.vertical, 16)
        }
        .navigationBarHidden(true)
        .safeAreaInset(edge: .top) {
            navigationBar
        }
        .safeAreaInset(edge: .bottom) {
            downloadButton
        }
        .confirmationDialog("", isPresented: $viewModel.presentActionSheet, titleVisibility: .hidden) {
            Button("report_a_problem_btn".localized) {
                coordinator.presentSheet(.sendMail("Problem with \(viewModel.subscribedPublication.title)"))
            }
        }
        .trackScreenView(
            "Book Details",
            properties: [
                "book_id": viewModel.subscribedPublication.id,
                "book_title": viewModel.subscribedPublication.title,
                "author": viewModel.subscribedPublication.availableAuthors,
                "is_AAX": viewModel.subscribedPublication.isAAX
            ]
        )
    }
    
    private var navigationBar: some View {
        HStack {
            Button(action: {
                coordinator.navigateBack()
            }) {
                if #available(iOS 26.0, *) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18))
                        .foregroundStyle(.customBlack)
                        .frame(width: 36, height: 36)
                        .glassEffect(in: .circle)
                } else {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18))
                        .foregroundStyle(.customBlack)
                        .frame(width: 36, height: 36)
                        .background(.ultraThinMaterial, in: .circle)
                }
            }
            
            Spacer()
            
            Button(action: {
                viewModel.presentActionSheet = true
            }) {
                if #available(iOS 26.0, *) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18))
                        .foregroundStyle(.customBlack)
                        .frame(width: 36, height: 36)
                        .glassEffect(in: .circle)
                } else {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18))
                        .foregroundStyle(.customBlack)
                        .frame(width: 36, height: 36)
                        .background(.ultraThinMaterial, in: .circle)
                }
            }
        }
        .padding(.horizontal, 16)
    }
    
    // MARK: - Parralax Section
    
    private var bookInfo: some View {
        VStack (alignment: .center, spacing: 24) {
            Spacer()
            
            if let url = URL(string: viewModel.subscribedPublication.coverArtUrl) {
                KFImage(url)
                    .resizable()
                    .scaledToFill()
                    .frame(
                        width: 208,
                        height: 208
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
                
            }
            
            VStack (alignment: .center, spacing: 6) {
                Text(viewModel.subscribedPublication.title)
                    .font(.system(size: 24, weight: .bold, design: .serif))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                
                if !viewModel.subscribedPublication.availableAuthors.isEmpty {
                    Text(viewModel.subscribedPublication.availableAuthors.joined(separator: ", "))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear {
                        if viewModel.sheetHeight == .zero {
                            viewModel.sheetHeight = proxy.size.height
                        }
                    }
            }
        }
    }
    
    private var publicationInfo: some View {
        HStack (spacing: 12) {
            if let year = viewModel.subscribedPublication.metadata?.year {
                PublicationInfoCell(
                    icon: "calendar",
                    title: year,
                    subtitle: "released_title".localized
                )
            }
            
            if let duration = viewModel.subscribedPublication.metadata?.duration {
                PublicationInfoCell(
                    icon: "clock",
                    title: duration.formatTimeToHHmm(),
                    subtitle: "duration_title".localized
                )
            }
            
            if let pagesCount = viewModel.subscribedPublication.metadata?.chapters.count {
                PublicationInfoCell(
                    icon: "book.closed",
                    title: "\(pagesCount) р",
                    subtitle: "chapters_title".localized
                )
            }
        }
        .padding(.horizontal, 16)
    }
    
    @ViewBuilder
    private var description: some View {
        if let description = viewModel.subscribedPublication.metadata?.description {
            VStack (alignment: .leading, spacing: 12) {
                Text("book_summary_title".localized)
                    .font(.system(size: 20, weight: .bold, design: .serif))
                    .foregroundStyle(.customBlack)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                
                Text(description)
                    .font(.system(size: 15, weight: .light))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
        }
    }
    
    // MARK: - Download Button
    
    private var downloadButton: some View {
        Button(action: {
            HapticFeedback.shared.trigger(style: .light)
            
            if diContainer.authService.isUserSignedIn() || diContainer.authService.isUserAnonymous() {
                Task { @MainActor in
                    await viewModel.addItemToUserLibrary()
                    withAnimation(.easeInOut(duration: 0.5)) {
                        coordinator.selectTab(.myLibrary)
                    }
                    
                    analytics.captureEvent(
                        "add_book",
                        properties: [
                            "book_id": viewModel.subscribedPublication.id,
                            "book_title": viewModel.subscribedPublication.title,
                            "author": viewModel.subscribedPublication.availableAuthors,
                            "is_AAX": viewModel.subscribedPublication.isAAX
                        ]
                    )
                }
            } else {
                signInRequiredAlert()
            }
            
        }) {
            HStack(spacing: 12) {
                if viewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                        .tint(.white)
                } else {
                    Image(systemName: viewModel.isAdded ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(.white)
                }
                
                if viewModel.isAdded {
                    Text("already_added_btn".localized)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                } else {
                    Text(viewModel.isAAXPublication ? "download_aaxtitle_btn".localized : "get_this_book_btn".localized)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(viewModel.isAdded ? Color(.systemGray4).gradient : Color.customIndigo.gradient)
                        .glassEffect(in: .rect(cornerRadius: 12))
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(viewModel.isAdded ? Color(.systemGray4).gradient : Color.customIndigo.gradient)
                }
            }
        }
        .padding(.bottom, 14)
        .padding(.horizontal, 14)
        .disabled(viewModel.isAdded)
    }
}

private extension PublicationDetailsView {
    private func signInRequiredAlert() {
        AlertManager.shared.showAlert(
            alertTitle: "catalogue_sign_in_required_alert_title".localized,
            alertMessage: "catalogue_sign_in_required_alert_message".localized,
            alertButtons: [
                .default("catalogue_sign_in_required_alert_sign_in_btn".localized) {
                    coordinator.presentSheet(.signIn)
                },
                .cancel("catalogue_sign_in_required_alert_cancel_btn".localized) {}
            ]
        )
    }
}
