//
//  AAXWebView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import WebKit
import Mixpanel

struct AAXWebView: UIViewRepresentable {
    @Binding var currentURL: URL?
    
    init(currentURL: Binding<URL?>) {
        self._currentURL = currentURL
    }
    
    class Coordinator: NSObject {
        var binding: Binding<URL?>
        
        init(binding: Binding<URL?>) {
            self.binding = binding
        }
        
        override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {
            if keyPath == "URL" {
                guard let webView = object as? WKWebView else { return }
                DispatchQueue.main.async {
                    self.binding.wrappedValue = webView.url
                }
            }
        }
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        
        // Add scripts to prevent zooming
        let zoomDisableScript = WKUserScript(
            source: """
                var meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
                document.getElementsByTagName('head')[0].appendChild(meta);
                
                var style = document.createElement('style');
                style.innerHTML = `
                    input, textarea, select {
                        font-size: 16px !important;
                        transform: scale(1) !important;
                    }
                `;
                document.head.appendChild(style);
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(zoomDisableScript)
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = "Audible/671 CFNetwork/1240.0.4 Darwin/20.6.0"
        
        // Disable scroll view zooming
        webView.scrollView.minimumZoomScale = 1.0
        webView.scrollView.maximumZoomScale = 1.0
        webView.scrollView.zoomScale = 1.0
        
        webView.addObserver(context.coordinator, forKeyPath: "URL", options: .new, context: nil)
        
        if let url = currentURL {
            webView.load(URLRequest(url: url))
        }
        
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(binding: $currentURL)
    }
    
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.removeObserver(coordinator, forKeyPath: "URL")
    }
}

struct AAXWebViewContainer: View {
    @ObservedObject var viewModel: AAXViewModel
    @ObservedObject var coordinator: AAXCoordinator
    private let dismiss: () -> Void
    
    @State private var showConsentDialog: Bool = true
    
    init(
        viewModel: AAXViewModel,
        coordinator: AAXCoordinator,
        dismiss: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        self.coordinator = coordinator
        self.dismiss = dismiss
    }
    
    var body: some View {
        AAXWebView(currentURL: $viewModel.currentURL)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarTitle("Sign in to \(viewModel.aaxProviderName)")
            .navigationBarBackButtonHidden(true)
            .overlay {
                consentView
            }
            .overlay {
                loadingPlaceholder
            }
            .onChange(of: viewModel.currentURL) {
                guard let url = viewModel.currentURL else { return }
                
                if url.absoluteString.contains("openid.oa2.authorization_code") {
                    print("🎉 Auth code detected in URL!")
                    
                    Task { @MainActor in
                        do {
                            try await viewModel.completeAuth(redirectURL: url.absoluteString)
                            viewModel.onSuccess?()
                            dismiss()
                            Mixpanel.mainInstance().track(event: "aax_library_connected")
                        } catch {
                            print("Error completing auth: \(error)")
                            dismiss()
                        }
                    }
                }
            }
            .trackScreenView("AAX Web View Sign In")
    }
    
    private var consentView: some View {
        AAXConsentView(
            viewModel: viewModel,
            onAccept: {
                showConsentDialog = false
            },
            onDecline: {
                dismiss()
            }
        )
        .opacity(showConsentDialog ? 1 : 0)
    }
    
    private var loadingPlaceholder: some View {
        ZStack {
            Color.customBackground
            Color.black.opacity(0.3)
            LoadifyView()
        }
        .opacity(viewModel.isLoading ? 1 : 0)
    }
}
