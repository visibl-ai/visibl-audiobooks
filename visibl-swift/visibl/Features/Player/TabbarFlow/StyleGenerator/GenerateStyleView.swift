//
//  GenerateStyleView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI

struct GenerateStyleView: View {
    @Environment(\.dismiss) private var dismiss
    private let coordinator: Coordinator
    @ObservedObject var playerCoordinator: PlayerCoordinator
    @ObservedObject var playerViewModel: PlayerViewModel
    @Bindable var sceneStylesViewModel: SceneStylesViewModel
    @State private var prompt: String = ""
    @FocusState private var isFocused: Bool
    private var showPlaceholder: Bool { prompt.isEmpty && !isFocused }
    
    init(
        coordinator: Coordinator,
        playerCoordinator: PlayerCoordinator,
        playerViewModel: PlayerViewModel,
        sceneStylesViewModel: SceneStylesViewModel
    ) {
        self.coordinator = coordinator
        self.playerCoordinator = playerCoordinator
        self.playerViewModel = playerViewModel
        self.sceneStylesViewModel = sceneStylesViewModel
    }
    
    var body: some View {
        VStack(spacing: 12) {
            topPlaceholder
            
            VStack(spacing: 8) {
                title
                textEditor
                bottomButtons
            }
            .padding(14)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .black.opacity(0.75)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .trackScreenView(
            "Generate New Style",
            properties: [
                "book_id": playerViewModel.audiobook.id,
                "book_title": playerViewModel.audiobook.title,
                "author": playerViewModel.audiobook.authors,
                "is_AAX": playerViewModel.audiobook.isAAX
            ]
        )
    }
    
    private var topPlaceholder: some View {
        Color.white.opacity(0.001)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onTapGesture {
                HapticFeedback.shared.trigger(style: .medium)
                playerCoordinator.selectTab(.bookInfo)
            }
    }
    
    private var title: some View {
        HStack(spacing: 6) {
            Image(systemName: "text.bubble")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
            Text("Prompt")
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private var textEditor: some View {
        ZStack(alignment: .topLeading) {
            // text editor
            VStack (spacing: 8) {
                TextEditor(text: $prompt)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white)
                    .frame(height: 100)
                    .cornerRadius(12)
                    .onSubmit {
                        isFocused = false
                    }
                    .focused($isFocused)
                    .scrollContentBackground(.hidden)
                    .keyboardType(.alphabet)
                    .onChange(of: isFocused) {
                        if isFocused && playerViewModel.authService.isUserAnonymous() {
                            isFocused = false
                            signInRequiredAlert()
                        }
                    }
                
                textEditorButtons
            }
            .padding(16)
            
            // placeholder text
            Text("Write your prompt or try suggest one")
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.75))
                .padding(16)
                .allowsHitTesting(false)
                .opacity(showPlaceholder ? 1 : 0)
        }
        // .background(.customDarkGrey.opacity(0.88))
        .background(.ultraThinMaterial)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.gray.gradient, lineWidth: 0.5)
        )
    }
    
    private var textEditorButtons: some View {
        HStack (alignment: .bottom) {
            HStack (alignment: .center, spacing: 12) {
                Button(action: {
                    HapticFeedback.shared.trigger(style: .light)
                    suggestPrompt()
                }, label: {
                    HStack (spacing: 8) {
                        Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white)
                        
                        Text("Suggest Prompt")
                            .font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .foregroundColor(.white)
                    }
                    .frame(height: 32)
                    .padding(.horizontal, 12)
                    .background {
                        if #available(iOS 26.0, *) {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(.black)
                                .glassEffect(in: .rect(cornerRadius: 10))
                        } else {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(.black)
                        }
                    }
                })
                .trackButtonTap("Suggest Style Prompt")
                
                if prompt != "" {
                    Button(action: {
                        HapticFeedback.shared.trigger(style: .light)
                        deletePrompt()
                    }, label: {
                        Image(systemName: "trash")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    })
                    .trackButtonTap("Clear Style Prompt")
                }
            }
            
            Spacer()
            
            Text("\(prompt.count)/240")
                .font(.system(size: 14, weight: .regular, design: .monospaced))
                .foregroundColor(.white)
        }
        .frame(height: 32)
    }
    
    private var bottomButtons: some View {
        HStack {
            Button(action: {
                HapticFeedback.shared.trigger(style: .light)
                isFocused.toggle()
            }) {
                Image(systemName: isFocused ? "keyboard.chevron.compact.down" : "keyboard")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(.white)
                    .padding()
                    .frame(width: 48, height: 48)
                    .background {
                        if #available(iOS 26.0, *) {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(.customIndigo.gradient)
                                .glassEffect(in: .rect(cornerRadius: 12))
                        } else {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(.customIndigo.gradient)
                        }
                    }
            }
            
            PlayerActionButton(
                text: "Create New Style",
                action: {
                    isFocused = false
                    Task { try await createNewStyle() }
                }
            )
            .disabled(prompt.isEmpty)
            .trackButtonTap("Create New Style")
        }
    }
}

private extension GenerateStyleView {
    private func suggestPrompt() {
        prompt = suggestedPrompts.randomElement() ?? ""
    }
    
    private func deletePrompt() {
        prompt = ""
    }
    
    @MainActor
    private func createNewStyle() async throws {
        if prompt.isEmpty {
            Toastify.show(style: .info, message: "Prompt cannot be empty")
            return
        }
        
        defer {
            Loadify.hide()
        }
        
        Loadify.show()
        let userPrompt = prompt
        
        do {
            let response: StyleModel = try await CloudFunctionService.shared.makeAuthenticatedCall(
                includeRawData: true,
                functionName: "v1addStyle",
                with: [
                    "sku": playerViewModel.audiobook.id,
                    "prompt": userPrompt,
                    "userDefault": true,
                    "currentTime": playerViewModel.currentTime
                ]
            )
            
            print("✅ New style created: \(response.title)")
            
            if let id = response.id {
                sceneStylesViewModel.currentStyleId = id
                sceneStylesViewModel.updateCurrentStyle(id)
            }
            
            // Reset State
            prompt = ""
            playerCoordinator.selectedTab = .bookInfo
            
        } catch {
            print("Error generating new scene style: \(error.localizedDescription)")
            Toastify.show(style: .error, message: "Failed to generate new scene style")
        }
    }
}

private extension GenerateStyleView {
    private func signInRequiredAlert() {
        AlertManager.shared.showAlert(
            alertTitle: "catalogue_sign_in_required_alert_title".localized,
            alertMessage: "catalogue_sign_in_required_alert_message".localized,
            alertButtons: [
                .default("catalogue_sign_in_required_alert_sign_in_btn".localized) {
                    let onSuccessHandler = {
                        coordinator.presentFullScreenCover(
                            .player(
                                coordinator,
                                playerViewModel.audiobook
                            )
                        )
                    }
                    
                    coordinator.dismissModal {
                        self.playerViewModel.stop()
                        coordinator.presentSheet(
                            .signInFromPlayer(
                                playerViewModel.audiobook,
                                onSuccess: onSuccessHandler
                            )
                        )
                    }
                },
                .cancel("catalogue_sign_in_required_alert_cancel_btn".localized) {}
            ]
        )
    }
}
