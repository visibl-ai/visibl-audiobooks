//
//  Models.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Foundation

enum TaskGroupStatusSTT: String, Codable {
    case preparing, waiting, transcribing, completed, error
    
    var title: String {
        switch self {
        case .preparing:
            return "Preparing"
        case .waiting:
            return "Waiting"
        case .transcribing:
            return "Transcribing"
        case .completed:
            return "Completed"
        case .error:
            return "Error"
        }
    }
}

@MainActor
final class TaskGroupModelSTT: @preconcurrency Identifiable {
    var id: String { userLibraryItem.id }
    var status: TaskGroupStatusSTT
    var tasks: [TaskModelSTT]
    let userLibraryItem: UserLibraryItemModel
    
    init(status: TaskGroupStatusSTT, tasks: [TaskModelSTT], userLibraryItem: UserLibraryItemModel) {
        self.status = status
        self.tasks = tasks
        self.userLibraryItem = userLibraryItem
    }
}

@MainActor
final class TaskModelSTT {
    let index: Int
    let audioURL: URL
    var isActive: Bool = false
    
    init(index: Int, audioURL: URL) {
        self.index = index
        self.audioURL = audioURL
    }
}

