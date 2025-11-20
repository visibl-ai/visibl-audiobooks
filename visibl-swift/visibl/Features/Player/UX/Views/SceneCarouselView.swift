//
//  SceneCarouselView.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import SwiftUI
import Kingfisher

struct SceneCarouselView: View {
    @Bindable var viewModel: SceneStylesViewModel
    @State var isScrollingDisabled: Bool = false
    @State var isVerticalDragGestureDisabled: Bool = false
    @State private var yOffset: CGFloat = 0
    
    // New state variables for the workaround
    @GestureState private var dragValue: DragGesture.Value?
    @State private var isDraggingVertically = false
    @State private var currentDragTranslation: CGSize = .zero
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack (spacing: 0) {
                    ForEach(viewModel.sortedStyles, id: \.key) { id, scene in
                        makeSceneImageView(for: id)
                            .frame(maxHeight: .infinity)
                            .containerRelativeFrame(.horizontal, count: 1, spacing: 0)
                            .clipShape(RoundedRectangle(cornerRadius: 52))
                            .scrollTransition(.animated, axis: .horizontal) { content, phase in
                                content
                                    .opacity(phase.isIdentity ? 1.0 : 0.8)
                                    .scaleEffect(phase.isIdentity ? 1.0 : 0.8)
                            }
                            .id(id)
                            .onDisappear {
                                // KingfisherManager.shared.cache.clearMemoryCache()
                            }
                    }
                }
                .scrollTargetLayout()
            }
            .background(.black)
            .scrollTargetBehavior(.viewAligned)
            .ignoresSafeArea()
            .scrollDisabled(isScrollingDisabled)
            // Move the simultaneousGesture to the ScrollView level
            .simultaneousGesture(
                DragGesture()
                    .updating($dragValue) { value, state, transaction in
                        state = value
                    }
            )
            .onAppear {
                let styleId = viewModel.styleIdFromClientData
                viewModel.updateCurrentStyle(styleId)
                proxy.scrollTo(styleId, anchor: .center)
            }
            .scrollPosition(id: $viewModel.currentStyleId)
            .onChange(of: viewModel.currentStyleId) { _, newStyleId in
                viewModel.updateCurrentStyle(newStyleId)
                viewModel.prefetchSceneImages()
            }
            .onScrollPhaseChange { _, newPhase in
                if newPhase == .idle {
                    isVerticalDragGestureDisabled = false
                } else {
                    isVerticalDragGestureDisabled = true
                }
            }
            .onChange(of: viewModel.currentSceneIndex) {
                viewModel.prefetchSceneImages()
            }
        }
    }
}

// ViewModifier for tracking drag gestures
struct VerticalDragTracker: ViewModifier {
    let dragValue: DragGesture.Value?
    @Binding var isDragging: Bool
    @Binding var translation: CGSize
    @Binding var isScrollDisabled: Bool
    let isVerticalDragDisabled: Bool
    let onEnded: (CGSize) -> Void
    
    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { geo in
                    Color.clear
                        .onChange(of: dragValue) { oldValue, newValue in
                            if isVerticalDragDisabled {
                                isDragging = false
                                return
                            }
                            
                            if let newValue {
                                if oldValue == nil {
                                    // Check if drag started inside this view
                                    let startedInside = geo.frame(in: .scrollView).contains(newValue.startLocation)
                                    if startedInside {
                                        let verticalDrag = abs(newValue.translation.height)
                                        let horizontalDrag = abs(newValue.translation.width)
                                        
                                        if verticalDrag > horizontalDrag {
                                            isDragging = true
                                            translation = newValue.translation
                                            isScrollDisabled = true
                                        }
                                    }
                                } else if isDragging {
                                    // Continue tracking the drag
                                    translation = newValue.translation
                                }
                            } else {
                                // Drag ended
                                if isDragging {
                                    onEnded(translation)
                                    isDragging = false
                                    isScrollDisabled = false
                                    translation = .zero
                                }
                            }
                        }
                }
            }
    }
}

extension SceneCarouselView {
    @ViewBuilder private func makeSceneImageView(for styleId: String?) -> some View {
        GeometryReader { geometry in
            if let imageUrl = viewModel.getSceneImageURLString(for: styleId) {
                KFImage(URL(string: imageUrl))
                    .resizable()
                    .fade(duration: 0.84)
                    .forceTransition()
                    .scaledToFill()
                    .frame(
                        width: geometry.size.width,
                        height: geometry.size.height
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 52))
                    .ignoresSafeArea()
                    .offset(y: isDraggingVertically ? currentDragTranslation.height : yOffset)
                    .animation(yOffset != 0 ? .spring(response: 0.4, dampingFraction: 0.8) : nil, value: yOffset)
                    .animation(isDraggingVertically ? nil : .spring(response: 0.4, dampingFraction: 0.8), value: currentDragTranslation)
                    .modifier(
                        VerticalDragTracker(
                            dragValue: dragValue,
                            isDragging: $isDraggingVertically,
                            translation: $currentDragTranslation,
                            isScrollDisabled: $isScrollingDisabled,
                            isVerticalDragDisabled: isVerticalDragGestureDisabled,
                            onEnded: handleDragEnded
                        )
                    )
            } else {
                Color.black
                    .frame(
                        width: geometry.size.width,
                        height: geometry.size.height
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 52))
                    .ignoresSafeArea()
                    .offset(y: isDraggingVertically ? currentDragTranslation.height : yOffset)
                    .animation(yOffset != 0 ? .spring(response: 0.3, dampingFraction: 0.6) : nil, value: yOffset)
                    .animation(isDraggingVertically ? nil : .spring(response: 0.3, dampingFraction: 0.6), value: currentDragTranslation)
                    .modifier(
                        VerticalDragTracker(
                            dragValue: dragValue,
                            isDragging: $isDraggingVertically,
                            translation: $currentDragTranslation,
                            isScrollDisabled: $isScrollingDisabled,
                            isVerticalDragDisabled: isVerticalDragGestureDisabled,
                            onEnded: handleDragEnded
                        )
                    )
            }
        }
    }
}

extension SceneCarouselView {
    func handleDragEnded(_ translation: CGSize) {
        let threshold: CGFloat = 120
        let dragHeight = translation.height
        let verticalDrag = abs(dragHeight)
        let horizontalDrag = abs(translation.width)
        
        if verticalDrag > horizontalDrag && verticalDrag > threshold {
            if dragHeight < 0 {
                swipeUp()
            } else {
                swipeDown()
            }
        } else {
            returnToCenter()
        }
    }
    
    func swipeUp() {
        withAnimation {
            yOffset = -UIScreen.main.bounds.height
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            viewModel.nextScene()
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            // viewModel.nextScene()
            // KingfisherManager.shared.cache.clearMemoryCache()
            returnToCenter()
        }
    }
    
    func swipeDown() {
        withAnimation {
            yOffset = UIScreen.main.bounds.height
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            viewModel.previousScene()
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            // viewModel.previousScene()
            // KingfisherManager.shared.cache.clearMemoryCache()
            returnToCenter()
        }
    }
    
    func returnToCenter() {
        yOffset = 0
        currentDragTranslation = .zero
    }
}
