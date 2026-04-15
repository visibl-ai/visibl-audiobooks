//
//  ImportViewModel.swift
//

import AVFoundation
import SwiftUI
import UniformTypeIdentifiers
import FirebaseStorage

@Observable final class ImportViewModel {
    private let coordinator: Coordinator
    private let diContainer: DIContainer
    private var userId: String? { diContainer.authService.getUserID() }
    var isAAXconnected: Bool { diContainer.aaxClient.isAuthenticated }
    var isFilePickerPresented: Bool = false

    private var storageUploadTask: StorageUploadTask?
    private var userCancelledUpload: Bool = false

    static let allowedContentTypes: [UTType] = [
        UTType(filenameExtension: "m4b") ?? .audio,
        UTType(filenameExtension: "m4a") ?? .audio
    ]

    init(
        coordinator: Coordinator,
        diContainer: DIContainer
    ) {
        self.coordinator = coordinator
        self.diContainer = diContainer
    }
    
    @MainActor
    private func addLink(_ urlString: String) async {
        do {
            Loadify.show()
            try await CloudFunctionService.shared.makeAuthCallWithOutReturn(
                includeRawData: true,
                functionName: "v1processCustomM4B",
                with: ["audioUrl": urlString]
            )
            Loadify.hide()
            Toastify.show(style: .success, message: "import_link_success_message".localized)
            // coordinator.dismissModal()
            // coordinator.selectTab(.myLibrary)
        } catch {
            Loadify.hide()
            Toastify.show(style: .error, message: "import_link_failed_message".localized)
            print("Error adding link: \(error)")
        }
    }
    
    func handleFileImportResult(_ result: Result<URL, Error>) {
        switch result {
        case .success(let fileUrl):
            Task { await uploadFile(fileUrl) }
        case .failure(let error):
            print("File import error: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func uploadFile(_ fileUrl: URL) async {
        guard let userId else { return }

        guard fileUrl.startAccessingSecurityScopedResource() else {
            print("Failed to access security scoped resource")
            return
        }

        let fileName = fileUrl.lastPathComponent
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

        do {
            try? FileManager.default.removeItem(at: tempURL)
            try FileManager.default.copyItem(at: fileUrl, to: tempURL)
        } catch {
            fileUrl.stopAccessingSecurityScopedResource()
            print("Failed to copy file: \(error)")
            return
        }

        fileUrl.stopAccessingSecurityScopedResource()

        // Validate that the file has chapter metadata
        do {
            let chapters = try await M4AUtility.getChapterInfo(for: tempURL)
            if chapters.isEmpty {
                try? FileManager.default.removeItem(at: tempURL)
                Toastify.show(style: .error, message: "import_no_chapters_error".localized)
                return
            }
        } catch {
            try? FileManager.default.removeItem(at: tempURL)
            Toastify.show(style: .error, message: "import_invalid_file_error".localized)
            return
        }

        let audioPath = "UserData/\(userId)/Uploads/Raw/\(fileName)"

        defer { try? FileManager.default.removeItem(at: tempURL) }

        let uploadProgress = UploadProgress.shared

        userCancelledUpload = false
        uploadProgress.onCancel = { [weak self] in
            self?.userCancelledUpload = true
            self?.storageUploadTask?.cancel()
            self?.storageUploadTask = nil
        }
        let sessionId = uploadProgress.show(message: "import_upload_preparing".localized)

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            storageUploadTask = CloudStorageManager.shared.uploadFile(
                from: tempURL,
                to: audioPath,
                onProgress: { progress in
                    uploadProgress.update(
                        progress: progress * 0.9,
                        for: sessionId
                    )
                },
                completion: { [weak self] result in
                    self?.storageUploadTask = nil

                    switch result {
                    case .success:
                        uploadProgress.update(
                            progress: 0.95,
                            for: sessionId
                        )

                        Task {
                            try? await CloudFunctionService.shared.makeAuthCallWithOutReturn(
                                includeRawData: true,
                                functionName: "v1processCustomM4B",
                                with: ["audioPath": audioPath]
                            )
                            
                            await MainActor.run {
                                uploadProgress.hide()
                                Toastify.show(style: .success, message: "import_success_message".localized)
                                self?.coordinator.dismissModal()
                                self?.coordinator.selectTab(.myLibrary)
                                NotificationCenter.default.post(name: .uploadedPublicationsDidChange, object: nil)
                            }
                        }

                    case .failure:
                        uploadProgress.hide()
                        // Don't show error toast if cancelled by user
                        if self?.userCancelledUpload != true {
                            Toastify.show(style: .error, message: "import_failed_message".localized)
                        }
                    }
                    continuation.resume()
                }
            )
        }
    }
}

// MARK: - Helpers

extension ImportViewModel {
    func isHidden(for option: ImportOption) -> Bool {
        option == .aax && isAAXconnected
    }
}

// MARK: - Navigation

extension ImportViewModel {
    func presentAAXconnect() {
        coordinator.presentSheet(.aaxSignIn(onSuccess: {
            self.coordinator.selectedCatalogueSource = .aax
        }))
    }
    
    func presentFilePicker() {
        DispatchQueue.main.async {
            self.isFilePickerPresented.toggle()
        }
    }
    
    func presentLinkAddAlert() {
        AlertUtil.shared.showTextInputAlert(
            alertTitle: "import_link_alert_title".localized,
            alertMessage: "import_link_alert_message".localized,
            alertButtons: [
                .cancel(title: "cancel_button".localized, action: nil),
                .default(title: "add_button".localized, action: { link in
                    Task { await self.addLink(link) }
                })
            ])
    }
}
