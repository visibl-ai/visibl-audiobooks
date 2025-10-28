//
//  AudiobookModel+Helpers.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation
import FirebaseAuth
import FirebaseDatabase

extension AudiobookModel {
    func updateProgress(currentProgress: Double, totralProgress: Double) {
        userLibraryItem.clientData.playbackInfo.progressInCurrentResource = currentProgress
        userLibraryItem.clientData.playbackInfo.totalProgress = totralProgress
    }
    
    func updateProgressInCurrentResouce(currentProgress: Double) {
        var info = userLibraryItem.clientData.playbackInfo
        info.progressInCurrentResource = currentProgress
        userLibraryItem.clientData.playbackInfo = info
    }
    
    func updateCurrentResourceIndex(index: Int) {
        userLibraryItem.clientData.playbackInfo.currentResourceIndex = index
        userLibraryItem.clientData.playbackInfo.progressInCurrentResource = 0.0
    }
    
    func updatePlaybackInfo(_ newInfo: PlaybackInfoModel) {
        userLibraryItem.clientData.playbackInfo = newInfo
    }
    
    func updateSceneInfo(_ newInfo: StyleInfoModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        userLibraryItem.clientData.sceneInfo = newInfo
        let path = "users/" + userID + "/library/" + publication.id + "/clientData/sceneInfo"
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(
                to: path,
                value: newInfo
            )
        }
    }
    
    func updateCurrentSceneStyle(styleId: String) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        userLibraryItem.clientData.sceneInfo?.currentSceneStyle = styleId
        let path = "users/" + userID + "/library/" + publication.id + "/clientData/sceneInfo/currentSceneStyle"
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(
                to: path,
                value: styleId
            )
        }
    }
    
    func updateCarouselIDs(carouselIDs: String) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        userLibraryItem.clientData.sceneInfo?.carouselList = carouselIDs
        let path = "users/" + userID + "/library/" + publication.id + "/clientData/sceneInfo/carouselList"
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(
                to: path,
                value: carouselIDs
            )
        }
    }
    
//    func addNewStyle(_ style: StyleModel) {
//        if publication.sceneStyles == nil {
//            publication.sceneStyles = [style]
//        } else {
//            publication.sceneStyles?.append(style)
//            publication.sceneStyles?.sort { $0.id < $1.id }
//        }
//    }
    
    func updateAAXInfo(_ newInfo: AAXInfoModel) {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        userLibraryItem.content?.aax = newInfo
        
        let path = "users/" + userID + "/library/" + publication.id + "/content/aax"
        
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(
                to: path,
                value: newInfo
            )
        }
    }
}

// MARK: - On Remote Data Managment

extension AudiobookModel {
    func updateBookProgressOnRemote() {
        guard let userID = Auth.auth().currentUser?.uid else { return }
        let path = "users/" + userID + "/library/" + publication.id + "/clientData/playbackInfo"
        DispatchQueue.global(qos: .background).async {
            RTDBManager.shared.writeData(to: path, value: self.userLibraryItem.clientData.playbackInfo)
        }
    }
}

// MARK: - Compose Audiobook

extension AudiobookModel {
    static func composeAudiobooks(
        from publications: [PublicationModel],
        and userLibraryItems: [UserLibraryItemModel]
    ) -> [AudiobookModel] {
        var newAudiobooks: [AudiobookModel] = []
        
        for libraryItem in userLibraryItems {
            if let matchingPublication = publications.first(where: { $0.id == libraryItem.id }) {
                let audiobook = AudiobookModel(
                    id: libraryItem.id,
                    publication: matchingPublication,
                    userLibraryItem: libraryItem
                )
                
                newAudiobooks.append(audiobook)
            }
        }
                
        return newAudiobooks
    }
}

// MARK: - AAX Cloud

extension AudiobookModel {
    func isUploadedOnCloud() async -> Bool {
        guard let userID = Auth.auth().currentUser?.uid else { return false }
        let path = "UserData/\(userID)/Uploads/Raw/\(id).m4b"
        
        do {
            _ = try await CloudStorageManager.shared.checkFileExists(at: path)
            return true
        } catch {
            return false
        }
    }
}
