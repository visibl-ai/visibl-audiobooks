//
//  PublicationDetailsViewModel.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import FirebaseAuth
import Mixpanel

@Observable final class PublicationDetailsViewModel {
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    var publication: PublicationPreviewModel
    
    var isActionSheetPresented: Bool = false
    var isLoading: Bool = false
    
    private var userLibraryObserver: UserLibraryObserver { diContainer.userLibraryObserver }
    private let rtdbManager = RTDBManager.shared

    var isAdded: Bool {
        userLibraryObserver.libraryItems.contains(where: { $0.id == publication.id })
    }

    var isAAXPublication: Bool {
        publication.visability == .private
    }

    init(
        coordinator: Coordinator,
        diContainer: DIContainer,
        publication: PublicationPreviewModel
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
        self.publication = publication
    }
}

// MARK: - Navigation
extension PublicationDetailsViewModel {
    func presentActionSheet() {
        isActionSheetPresented.toggle()
    }
    
    func presentSignIn() {
        coordinator.presentSheet(.signIn)
    }
    
    func selectLibraryTab() {
        coordinator.selectTab(.myLibrary)
    }
    
    func navigateBack() {
        coordinator.navigateBack()
    }
}

// MARK: - Alerts
extension PublicationDetailsViewModel {
    func showSignInRequiredAlert() {
        AlertUtil.shared.showAlert(
            alertTitle: "catalogue_sign_in_required_alert_title".localized,
            alertMessage: "catalogue_sign_in_required_alert_message".localized,
            alertButtons: [
                .default("catalogue_sign_in_required_alert_sign_in_btn".localized) {
                    self.presentSignIn()
                },
                .cancel("catalogue_sign_in_required_alert_cancel_btn".localized) {}
            ]
        )
    }
}

// MARK: - Add book
extension PublicationDetailsViewModel {
    func handleAddBookTap() {
        HapticFeedback.trigger(style: .light)

        if diContainer.authService.isUserSignedIn() || diContainer.authService.isUserAnonymous() {
            Task { @MainActor in
                await addItemToUserLibrary()
                withAnimation(.easeInOut(duration: 0.5)) {
                    coordinator.selectTab(.myLibrary)
                }

                trackBookAdd()
            }
        } else {
            showSignInRequiredAlert()
        }
    }

    @MainActor
    private func addItemToUserLibrary() async {
        isLoading = true

        do {
            // clean up any leftovers
            guard let userID = Auth.auth().currentUser?.uid else { return }
            let path = "users/\(userID)/library/\(publication.id)"
            try await rtdbManager.deleteData(at: path)
            // add books
            try await UserLibraryService.addAudiobookToUserLibrary(sku: publication.id)
            try await Task.sleep(for: .seconds(1))
            isLoading = false
            trackMixpanelBookAdded()
        } catch {
            isLoading = false
            print(error.localizedDescription)
        }
    }

    private func trackMixpanelBookAdded() {
        switch publication.visability {
        case .public:
            Mixpanel.mainInstance().track(event: "public_book_added")
        case .private:
            Mixpanel.mainInstance().track(event: "aax_book_added")
        }
    }

    private func trackBookAdd() {
        AnalyticsManager.shared.captureEvent(
            "add_book",
            properties: [
                "book_id": publication.id,
                "book_title": publication.title,
                "author": publication.authors,
                "is_AAX": isAAXPublication
            ]
        )
    }
}

// MARK: - Action Sheet
extension PublicationDetailsViewModel {
    func handleReportProblem() {
        coordinator.presentSheet(.sendMail("Problem with \(publication.title)"))
    }
}

// MARK: - Screen Tracking
extension PublicationDetailsViewModel {
    var screenTrackingProperties: [String: Any] {
        [
            "book_id": publication.id,
            "book_title": publication.title,
            "author": publication.authors,
            "is_AAX": isAAXPublication
        ]
    }
}
