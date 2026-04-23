import Foundation
import SQLite3

enum DatabaseError: Error {
    case notFound(String)
    case openFailed(String)
    case queryFailed(String)
}

struct EncryptedItem {
    let id: String
    let type: String
    let encryptedDataBase64: String
}

func readCredentials() throws -> [EncryptedItem] {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.keykeykey.shared"
    ) else {
        throw DatabaseError.notFound("App group container not found")
    }

    // Prefer the Library/ subdirectory (current main-app path), fall back to
    // the container root for older installs.
    let candidates = [
        containerURL.appendingPathComponent("Library/keykeykey.db"),
        containerURL.appendingPathComponent("keykeykey.db"),
    ]
    guard let dbURL = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
        let paths = candidates.map { $0.path }.joined(separator: ", ")
        throw DatabaseError.notFound("Database file not found at \(paths)")
    }
    let dbPath = dbURL.path

    var db: OpaquePointer?
    let openFlags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
    guard sqlite3_open_v2(dbPath, &db, openFlags, nil) == SQLITE_OK else {
        let errMsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
        sqlite3_close(db)
        throw DatabaseError.openFailed("Failed to open database: \(errMsg)")
    }

    defer {
        sqlite3_close(db)
    }

    let query = "SELECT id, type, encrypted_data FROM vault_items WHERE type = 'credential'"
    var statement: OpaquePointer?

    guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else {
        let errMsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
        throw DatabaseError.queryFailed("Failed to prepare query: \(errMsg)")
    }

    defer {
        sqlite3_finalize(statement)
    }

    var items: [EncryptedItem] = []

    while sqlite3_step(statement) == SQLITE_ROW {
        let id = statement.flatMap { stmt -> String? in
            guard let cStr = sqlite3_column_text(stmt, 0) else { return nil }
            return String(cString: cStr)
        } ?? ""

        let type = statement.flatMap { stmt -> String? in
            guard let cStr = sqlite3_column_text(stmt, 1) else { return nil }
            return String(cString: cStr)
        } ?? ""

        let encryptedDataBase64 = statement.flatMap { stmt -> String? in
            guard let cStr = sqlite3_column_text(stmt, 2) else { return nil }
            return String(cString: cStr)
        } ?? ""

        items.append(EncryptedItem(id: id, type: type, encryptedDataBase64: encryptedDataBase64))
    }

    return items
}
