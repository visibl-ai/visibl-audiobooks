//
//  CodableAppStorage.swift
//  visibl
//
//  Copyright (c) 2025 Visibl Holdings Limited
//

import Combine
import SwiftUI

@MainActor
private var subscriptions = [String : AnyCancellable] ()

// MARK: - Published+UserDefaults

extension Published where Value: Codable {
    @MainActor
    init(wrappedValue defaultValue: Value, codableKey key: String) {
        let value = (try? UserDefaults.standard.codable(for: key)) ?? defaultValue
        self.init(initialValue: value)
        subscriptions[key] = projectedValue.dropFirst().sink { newValue in
            try? UserDefaults.standard.setCodable(newValue, key: key)
        }
    }
}

extension Published {
    @MainActor
    init(wrappedValue defaultValue: Value, key: String) {
        let value = (UserDefaults.standard.object(forKey: key) as? Value) ?? defaultValue
        self.init(initialValue: value)
        subscriptions[key] = projectedValue.dropFirst().sink { newValue in
            UserDefaults.standard.set(newValue, forKey: key)
        }
    }
}


// MARK: - CodableAppStorage

@propertyWrapper
struct CodableAppStorage<Value: Codable>: DynamicProperty {
    private let key: String
    private let defaultValue: Value
    @State private var value: Value
    init(wrappedValue defaultValue: Value, _ key: String) {
        self.key = key
        self.defaultValue = defaultValue
        let value = (try? UserDefaults.standard.codable(for: key)) ?? defaultValue
        self._value = .init(initialValue: value)
    }
    
    init(_ key: String, defaultValue: Value) {
        self.key = key
        self.defaultValue = defaultValue
        let value = (try? UserDefaults.standard.codable(for: key)) ?? defaultValue
        self._value = .init(initialValue: value)
    }
    
    var wrappedValue: Value {
        get {
            value
        }
        nonmutating set {
            value = newValue
            try? UserDefaults.standard.setCodable(newValue, key: key)
        }
    }
    
    var projectedValue: Binding<Value> {
        Binding(
            get: { wrappedValue },
            set: { wrappedValue = $0 }
        )
    }
}

// MARK: - UserDefault

/// Usage: @UserDefault(key: "username", defaultValue: "") var username: String
/// or @UserDefault(key: "username") var username: String = ""
@propertyWrapper
public struct UserDefault<T> {
    private let key: String
    private let defaultValue: T
    private var container: UserDefaults
    
    public init(key: String, defaultValue: T, container: UserDefaults = .standard) {
        self.key = key
        self.defaultValue = defaultValue
        self.container = container
    }
    
    public init(wrappedValue: T, key: String, container: UserDefaults = .standard) {
        self.key = key
        self.defaultValue = wrappedValue
        self.container = container
    }
    
    public var wrappedValue: T {
        get {
            (container.object(forKey: key) as? T) ?? defaultValue
        }
        set {
            if let newValue = newValue as? AnyOptional, newValue.isNil {
                container.removeObject(forKey: key)
            } else {
                container.set(newValue, forKey: key)
            }
        }
    }
}

// MARK: - CodableUserDefault

@propertyWrapper
public struct CodableUserDefault<T: Codable> {
    private let key: String
    private let defaultValue: T
    
    public init(key: String, defaultValue: T) {
        self.key = key
        self.defaultValue = defaultValue
    }
    
    public init(wrappedValue: T, key: String) {
        self.key = key
        self.defaultValue = wrappedValue
    }
    
    public var wrappedValue: T {
        get {
            (try? UserDefaults.standard.codable(for: key)) ?? defaultValue
        }
        set {
            if let newValue = newValue as? AnyOptional, newValue.isNil {
                UserDefaults.standard.removeObject(forKey: key)
            } else {
                try? UserDefaults.standard.setCodable(newValue, key: key)
            }
        }
    }
}

@propertyWrapper
public struct CachedCodableUserDefault<T: Codable> {
    private var value: CodableUserDefault<T>
    private var cached: T
    
    public init(key: String, defaultValue: T) {
        self.value = .init(key: key, defaultValue: defaultValue)
        self.cached = value.wrappedValue
    }
    
    public init(wrappedValue: T, key: String) {
        self.value = .init(key: key, defaultValue: wrappedValue)
        self.cached = value.wrappedValue
    }
    
    public var wrappedValue: T {
        get { cached }
        set {
            cached = newValue
            value.wrappedValue = newValue
        }
    }
}

@propertyWrapper
public struct CachedUserDefault<T> {
    private var value: UserDefault<T>
    private var cached: T
    
    public init(key: String, defaultValue: T) {
        self.value = .init(key: key, defaultValue: defaultValue)
        self.cached = value.wrappedValue
    }
    
    public init(wrappedValue: T, key: String) {
        self.value = .init(key: key, defaultValue: wrappedValue)
        self.cached = value.wrappedValue
    }
    
    public var wrappedValue: T {
        get { cached }
        set {
            cached = newValue
            value.wrappedValue = newValue
        }
    }
}

private protocol AnyOptional {
    var isNil: Bool { get }
}

extension Optional: AnyOptional {
    var isNil: Bool { self == nil }
}


// MARK: - UserDefaults+Codable

extension UserDefaults {
    func setCodable<T: Codable>(_ object: T, key: String) throws {
        let data = try JSONEncoder().encode(object)
        set(data, forKey: key)
    }
    
    func codable<T: Codable>(for key: String) throws -> T? {
        guard let data = data(forKey: key) else { return nil }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
