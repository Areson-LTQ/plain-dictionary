use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    fs::File,
    io::{Cursor, Read},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

struct AppState {
    dictionary: Mutex<Connection>,
    user: Mutex<Connection>,
    dictionary_path: PathBuf,
}

const LEGACY_IDENTIFIER: &str = "com.plaindictionary.app";
const USER_SCHEMA_VERSION: i64 = 1;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_DICTIONARY_DOWNLOAD_BYTES: usize = 100 * 1024 * 1024;
const USER_SCHEMA_V1: &str = "CREATE TABLE IF NOT EXISTS query_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       entry_id TEXT NOT NULL,
       headword TEXT NOT NULL,
       language TEXT NOT NULL,
       queried_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     );
     CREATE INDEX IF NOT EXISTS idx_query_events_recent ON query_events(queried_at DESC);
     CREATE TABLE IF NOT EXISTS query_stats (
       entry_id TEXT PRIMARY KEY,
       headword TEXT NOT NULL,
       language TEXT NOT NULL,
       query_count INTEGER NOT NULL DEFAULT 0,
       last_queried_at TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS favorite_folders (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL COLLATE NOCASE UNIQUE,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     );
     CREATE TABLE IF NOT EXISTS favorite_entries (
       folder_id INTEGER NOT NULL REFERENCES favorite_folders(id) ON DELETE CASCADE,
       entry_id TEXT NOT NULL,
       headword TEXT NOT NULL,
       language TEXT NOT NULL,
       added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       PRIMARY KEY(folder_id, entry_id)
     );
     CREATE TABLE IF NOT EXISTS app_settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );
     INSERT OR IGNORE INTO app_settings(key, value) VALUES ('always_on_top', 'false');";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntrySummary {
    id: String,
    headword: String,
    language: String,
    ipa: Option<String>,
    pronunciation: Option<String>,
    traditional: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SenseGroup {
    part_of_speech: Option<String>,
    definitions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryEntry {
    id: String,
    headword: String,
    normalized_headword: String,
    language: String,
    ipa: Option<String>,
    pronunciation: Option<String>,
    traditional: Option<String>,
    source: String,
    senses: Vec<SenseGroup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentQuery {
    entry_id: String,
    headword: String,
    language: String,
    queried_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryStat {
    entry_id: String,
    headword: String,
    language: String,
    query_count: i64,
    last_queried_at: String,
    available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteFolder {
    id: i64,
    name: String,
    created_at: String,
    entries: Vec<FavoriteEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteEntry {
    entry_id: String,
    headword: String,
    language: String,
    added_at: String,
    available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    always_on_top: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    version: String,
    built_at: String,
    sources: String,
    license: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryUpdateManifest {
    schema_version: u32,
    dictionary_version: String,
    published_at: String,
    url: String,
    size: u64,
    sha256: String,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryUpdateInfo {
    configured: bool,
    current_version: String,
    latest_version: Option<String>,
    published_at: Option<String>,
    download_size: Option<u64>,
    update_available: bool,
}

fn normalize_query(value: &str) -> String {
    value.trim().to_lowercase()
}

fn db_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn initialize_dictionary(path: &PathBuf) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=DELETE;
             CREATE TABLE entries (
               id TEXT PRIMARY KEY,
               headword TEXT NOT NULL,
               normalized_headword TEXT NOT NULL,
               language TEXT NOT NULL CHECK(language IN ('en', 'zh')),
               ipa TEXT,
               pronunciation TEXT,
               traditional TEXT,
               source TEXT NOT NULL
             );
             CREATE INDEX idx_entries_headword ON entries(language, normalized_headword);
             CREATE TABLE senses (
               id INTEGER PRIMARY KEY,
               entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
               part_of_speech TEXT,
               definition TEXT NOT NULL,
               position INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX idx_senses_entry ON senses(entry_id, position);
             CREATE TABLE entry_search (
               entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
               term TEXT NOT NULL,
               normalized_term TEXT NOT NULL,
               PRIMARY KEY(entry_id, normalized_term)
             );
             CREATE INDEX idx_entry_search_term ON entry_search(normalized_term);
             CREATE TABLE dictionary_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .map_err(db_error)?;
    connection
        .execute_batch(include_str!("dictionary_seed.sql"))
        .map_err(db_error)?;
    connection.close().map_err(|(_, error)| db_error(error))
}

fn validate_dictionary(path: &PathBuf) -> Result<String, String> {
    let connection =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(db_error)?;
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(db_error)?;
    if integrity != "ok" {
        return Err(format!("词库完整性检查失败: {integrity}"));
    }
    let entry_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
        .map_err(db_error)?;
    if entry_count == 0 {
        return Err("词库没有任何词条".into());
    }
    let version = connection
        .query_row(
            "SELECT value FROM dictionary_metadata WHERE key = 'version'",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    connection.close().map_err(|(_, error)| db_error(error))?;
    Ok(version)
}

fn rename_dictionary_file(source: &PathBuf, destination: &PathBuf) -> Result<(), String> {
    for attempt in 0..5 {
        match fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if attempt < 4
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                    ) =>
            {
                thread::sleep(Duration::from_millis(25 * (1 << attempt)));
            }
            Err(error) => {
                return Err(format!(
                    "无法将 {} 移动到 {}: {error}",
                    source.display(),
                    destination.display()
                ));
            }
        }
    }
    unreachable!("rename retry loop always returns")
}

fn recover_dictionary_backup(target: &PathBuf) -> Result<(), String> {
    let backup = target.with_extension("sqlite.backup");
    if target.exists() {
        if backup.exists() {
            fs::remove_file(backup).map_err(db_error)?;
        }
    } else if backup.exists() {
        rename_dictionary_file(&backup, target)?;
    }
    Ok(())
}

fn install_dictionary_file(bundled: &PathBuf, target: &PathBuf) -> Result<bool, String> {
    recover_dictionary_backup(target)?;
    let bundled_version = validate_dictionary(bundled)?;
    if validate_dictionary(target).ok().as_deref() == Some(bundled_version.as_str()) {
        return Ok(false);
    }

    let temporary = target.with_extension("sqlite.new");
    let backup = target.with_extension("sqlite.backup");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(db_error)?;
    }
    fs::copy(bundled, &temporary).map_err(db_error)?;
    File::options()
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("无法打开临时词库 {}: {error}", temporary.display()))?
        .sync_all()
        .map_err(|error| format!("无法同步临时词库 {}: {error}", temporary.display()))?;
    if validate_dictionary(&temporary)? != bundled_version {
        fs::remove_file(temporary).map_err(db_error)?;
        return Err("复制后的词库版本不一致".into());
    }

    if target.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(db_error)?;
        }
        rename_dictionary_file(target, &backup)?;
    }
    if let Err(error) = rename_dictionary_file(&temporary, target) {
        if backup.exists() {
            let _ = rename_dictionary_file(&backup, target);
        }
        return Err(error);
    }
    if backup.exists() {
        fs::remove_file(backup).map_err(db_error)?;
    }
    Ok(true)
}

fn install_bundled_dictionary(app: &tauri::App, target: &PathBuf) -> Result<bool, String> {
    let packaged_path = app
        .path()
        .resolve("resources/dictionary.sqlite", BaseDirectory::Resource)
        .map_err(db_error)?;
    let development_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dictionary.sqlite");
    let bundled = if packaged_path.exists() {
        packaged_path
    } else if development_path.exists() {
        development_path
    } else {
        return Ok(false);
    };

    let bundled_version = validate_dictionary(&bundled)?;
    if let Ok(current_version) = validate_dictionary(target) {
        if !is_newer_version(&bundled_version, &current_version) {
            return Ok(false);
        }
    }
    install_dictionary_file(&bundled, target)
}

fn migrate_user_database(connection: &mut Connection) -> Result<(), String> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db_error)?;
    if version > USER_SCHEMA_VERSION {
        return Err(format!(
            "用户数据库版本 {version} 高于应用支持的版本 {USER_SCHEMA_VERSION}"
        ));
    }
    if version < 1 {
        let transaction = connection.transaction().map_err(db_error)?;
        transaction
            .execute_batch(USER_SCHEMA_V1)
            .map_err(db_error)?;
        transaction
            .pragma_update(None, "user_version", 1)
            .map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
    }
    Ok(())
}

fn initialize_user_database(path: &PathBuf) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(db_error)?;
    connection
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(db_error)?;
    migrate_user_database(&mut connection)?;
    Ok(connection)
}

fn migrate_legacy_app_data(app_data: &PathBuf) -> Result<(), String> {
    let Some(parent) = app_data.parent() else {
        return Ok(());
    };
    let legacy = parent.join(LEGACY_IDENTIFIER);
    if !legacy.exists() {
        return Ok(());
    }
    if !app_data.exists() {
        fs::rename(legacy, app_data).map_err(db_error)?;
        return Ok(());
    }

    for filename in [
        "dictionary.sqlite",
        "user.sqlite",
        "user.sqlite-shm",
        "user.sqlite-wal",
    ] {
        let source = legacy.join(filename);
        let destination = app_data.join(filename);
        if source.exists() && !destination.exists() {
            fs::rename(source, destination).map_err(db_error)?;
        }
    }
    if fs::read_dir(&legacy).map_err(db_error)?.next().is_none() {
        fs::remove_dir(legacy).map_err(db_error)?;
    }
    Ok(())
}

fn entry_exists(dictionary: &Connection, entry_id: &str) -> bool {
    dictionary
        .query_row(
            "SELECT 1 FROM entries WHERE id = ?1",
            [entry_id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn load_entry(dictionary: &Connection, entry_id: &str) -> Result<DictionaryEntry, String> {
    let mut entry = dictionary
        .query_row(
            "SELECT id, headword, normalized_headword, language, ipa, pronunciation, traditional, source
             FROM entries WHERE id = ?1",
            [entry_id],
            |row| {
                Ok(DictionaryEntry {
                    id: row.get(0)?,
                    headword: row.get(1)?,
                    normalized_headword: row.get(2)?,
                    language: row.get(3)?,
                    ipa: row.get(4)?,
                    pronunciation: row.get(5)?,
                    traditional: row.get(6)?,
                    source: row.get(7)?,
                    senses: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "词条不存在或当前词库暂不可用".to_string())?;

    let mut statement = dictionary
        .prepare(
            "SELECT part_of_speech, definition FROM senses
             WHERE entry_id = ?1 ORDER BY position, id",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([entry_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_error)?;
    let mut groups: BTreeMap<Option<String>, Vec<String>> = BTreeMap::new();
    for row in rows {
        let (part_of_speech, definition) = row.map_err(db_error)?;
        groups.entry(part_of_speech).or_default().push(definition);
    }
    entry.senses = groups
        .into_iter()
        .map(|(part_of_speech, definitions)| SenseGroup {
            part_of_speech,
            definitions,
        })
        .collect();
    Ok(entry)
}

fn record_query_inner(state: &AppState, entry_id: &str) -> Result<(), String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let entry = load_entry(&dictionary, entry_id)?;
    drop(dictionary);
    let mut user = state.user.lock().map_err(db_error)?;
    let transaction = user.transaction().map_err(db_error)?;
    transaction
        .execute(
            "INSERT INTO query_events(entry_id, headword, language) VALUES (?1, ?2, ?3)",
            params![entry.id, entry.headword, entry.language],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "INSERT INTO query_stats(entry_id, headword, language, query_count, last_queried_at)
             VALUES (?1, ?2, ?3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(entry_id) DO UPDATE SET
               headword = excluded.headword,
               language = excluded.language,
               query_count = query_stats.query_count + 1,
               last_queried_at = excluded.last_queried_at",
            params![entry.id, entry.headword, entry.language],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)
}

#[tauri::command]
fn search_entries(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<EntrySummary>, String> {
    let normalized = normalize_query(&query);
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let upper_bound = format!("{}\u{10ffff}", normalized);
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let mut statement = dictionary
        .prepare(
            "SELECT DISTINCT e.id, e.headword, e.language, e.ipa, e.pronunciation, e.traditional
             FROM entry_search s JOIN entries e ON e.id = s.entry_id
             WHERE s.normalized_term >= ?1 AND s.normalized_term < ?2
             ORDER BY CASE WHEN s.normalized_term = ?1 THEN 0 ELSE 1 END,
                      length(s.normalized_term), e.headword
             LIMIT ?3",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![normalized, upper_bound, limit.unwrap_or(12).min(50)],
            |row| {
                Ok(EntrySummary {
                    id: row.get(0)?,
                    headword: row.get(1)?,
                    language: row.get(2)?,
                    ipa: row.get(3)?,
                    pronunciation: row.get(4)?,
                    traditional: row.get(5)?,
                })
            },
        )
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

#[tauri::command]
fn get_entry(state: State<'_, AppState>, entry_id: String) -> Result<DictionaryEntry, String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    load_entry(&dictionary, &entry_id)
}

#[tauri::command]
fn record_query(state: State<'_, AppState>, entry_id: String) -> Result<(), String> {
    record_query_inner(&state, &entry_id)
}

#[tauri::command]
fn get_recent_queries(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<RecentQuery>, String> {
    let user = state.user.lock().map_err(db_error)?;
    let mut statement = user
        .prepare(
            "SELECT event.entry_id, event.headword, event.language, event.queried_at
             FROM query_events event
             JOIN (
               SELECT entry_id, MAX(id) AS latest_id
               FROM query_events
               GROUP BY entry_id
               ORDER BY latest_id DESC
               LIMIT ?1
             ) recent ON recent.latest_id = event.id
             ORDER BY event.id DESC",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([limit.unwrap_or(20).min(20)], |row| {
            Ok(RecentQuery {
                entry_id: row.get(0)?,
                headword: row.get(1)?,
                language: row.get(2)?,
                queried_at: row.get(3)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

#[tauri::command]
fn get_query_stats(state: State<'_, AppState>) -> Result<Vec<QueryStat>, String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let user = state.user.lock().map_err(db_error)?;
    let mut statement = user
        .prepare(
            "SELECT entry_id, headword, language, query_count, last_queried_at
             FROM query_stats ORDER BY query_count DESC, last_queried_at DESC",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            let entry_id: String = row.get(0)?;
            Ok(QueryStat {
                available: entry_exists(&dictionary, &entry_id),
                entry_id,
                headword: row.get(1)?,
                language: row.get(2)?,
                query_count: row.get(3)?,
                last_queried_at: row.get(4)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

#[tauri::command]
fn list_favorite_folders(state: State<'_, AppState>) -> Result<Vec<FavoriteFolder>, String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let user = state.user.lock().map_err(db_error)?;
    let mut folder_statement = user
        .prepare("SELECT id, name, created_at FROM favorite_folders ORDER BY created_at, id")
        .map_err(db_error)?;
    let folder_rows = folder_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?;
    let mut folders = Vec::new();
    for folder in folder_rows {
        let (id, name, created_at) = folder.map_err(db_error)?;
        let mut entry_statement = user.prepare("SELECT entry_id, headword, language, added_at FROM favorite_entries WHERE folder_id = ?1 ORDER BY added_at DESC").map_err(db_error)?;
        let entry_rows = entry_statement
            .query_map([id], |row| {
                let entry_id: String = row.get(0)?;
                Ok(FavoriteEntry {
                    available: entry_exists(&dictionary, &entry_id),
                    entry_id,
                    headword: row.get(1)?,
                    language: row.get(2)?,
                    added_at: row.get(3)?,
                })
            })
            .map_err(db_error)?;
        folders.push(FavoriteFolder {
            id,
            name,
            created_at,
            entries: entry_rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?,
        });
    }
    Ok(folders)
}

fn validate_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 40 {
        Err("收藏夹名称需为 1 到 40 个字符".into())
    } else {
        Ok(trimmed.to_string())
    }
}

#[tauri::command]
fn create_favorite_folder(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    let name = validate_folder_name(&name)?;
    let user = state.user.lock().map_err(db_error)?;
    user.execute("INSERT INTO favorite_folders(name) VALUES (?1)", [name])
        .map_err(|error| {
            if error.to_string().contains("UNIQUE") {
                "收藏夹名称已存在".into()
            } else {
                db_error(error)
            }
        })?;
    Ok(user.last_insert_rowid())
}

#[tauri::command]
fn rename_favorite_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    name: String,
) -> Result<(), String> {
    let name = validate_folder_name(&name)?;
    let user = state.user.lock().map_err(db_error)?;
    let changed = user
        .execute(
            "UPDATE favorite_folders SET name = ?1 WHERE id = ?2",
            params![name, folder_id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("收藏夹不存在".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn delete_favorite_folder(state: State<'_, AppState>, folder_id: i64) -> Result<(), String> {
    let user = state.user.lock().map_err(db_error)?;
    user.execute("DELETE FROM favorite_folders WHERE id = ?1", [folder_id])
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn add_favorite(
    state: State<'_, AppState>,
    folder_id: i64,
    entry_id: String,
) -> Result<(), String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let entry = load_entry(&dictionary, &entry_id)?;
    let user = state.user.lock().map_err(db_error)?;
    user.execute(
        "INSERT OR IGNORE INTO favorite_entries(folder_id, entry_id, headword, language) VALUES (?1, ?2, ?3, ?4)",
        params![folder_id, entry.id, entry.headword, entry.language],
    ).map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn remove_favorite(
    state: State<'_, AppState>,
    folder_id: i64,
    entry_id: String,
) -> Result<(), String> {
    state
        .user
        .lock()
        .map_err(db_error)?
        .execute(
            "DELETE FROM favorite_entries WHERE folder_id = ?1 AND entry_id = ?2",
            params![folder_id, entry_id],
        )
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let value: String = state
        .user
        .lock()
        .map_err(db_error)?
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'always_on_top'",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    Ok(AppSettings {
        always_on_top: value == "true",
    })
}

#[tauri::command]
fn set_always_on_top(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window.set_always_on_top(enabled).map_err(db_error)?;
    state.user.lock().map_err(db_error)?.execute(
        "INSERT INTO app_settings(key, value) VALUES ('always_on_top', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [if enabled { "true" } else { "false" }],
    ).map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn open_management_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("management") {
        window.show().map_err(db_error)?;
        window.set_focus().map_err(db_error)?;
        window
            .emit("select-tab", tab.unwrap_or_else(|| "stats".into()))
            .map_err(db_error)?;
        return Ok(());
    }
    let url = format!(
        "index.html?window=management&tab={}",
        tab.unwrap_or_else(|| "stats".into())
    );
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    WebviewWindowBuilder::new(&app, "management", WebviewUrl::App(url.into()))
        .parent(&main_window)
        .map_err(db_error)?
        .title("简词 · 管理")
        .inner_size(760.0, 620.0)
        .min_inner_size(600.0, 460.0)
        .center()
        .build()
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn focus_main_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    record_query_inner(&state, &entry_id)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window.show().map_err(db_error)?;
    window.set_focus().map_err(db_error)?;
    window.emit("open-entry", entry_id).map_err(db_error)
}

#[tauri::command]
fn dictionary_metadata(state: State<'_, AppState>) -> Result<Metadata, String> {
    let dictionary = state.dictionary.lock().map_err(db_error)?;
    let read = |key: &str| {
        dictionary
            .query_row(
                "SELECT value FROM dictionary_metadata WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_default()
    };
    Ok(Metadata {
        version: read("version"),
        built_at: read("built_at"),
        sources: read("sources"),
        license: read("license"),
    })
}

fn update_configuration() -> Option<(&'static str, &'static str)> {
    let manifest_url = option_env!("PLAIN_DICTIONARY_UPDATE_MANIFEST_URL")?.trim();
    let public_key = option_env!("PLAIN_DICTIONARY_UPDATE_PUBLIC_KEY")?.trim();
    if manifest_url.is_empty() || public_key.is_empty() {
        None
    } else {
        Some((manifest_url, public_key))
    }
}

fn manifest_signature_payload(manifest: &DictionaryUpdateManifest) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        manifest.schema_version,
        manifest.dictionary_version,
        manifest.published_at,
        manifest.url,
        manifest.size,
        manifest.sha256.to_lowercase()
    )
}

fn verify_update_manifest(
    manifest: &DictionaryUpdateManifest,
    public_key: &str,
) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持词库更新清单版本 {}",
            manifest.schema_version
        ));
    }
    let url = reqwest::Url::parse(&manifest.url).map_err(db_error)?;
    if url.scheme() != "https" {
        return Err("词库下载地址必须使用 HTTPS".into());
    }
    if manifest.size == 0 || manifest.size as usize > MAX_DICTIONARY_DOWNLOAD_BYTES {
        return Err("词库下载大小超出允许范围".into());
    }
    if manifest.sha256.len() != 64 || hex::decode(&manifest.sha256).is_err() {
        return Err("词库 SHA-256 格式无效".into());
    }

    let key_bytes = BASE64.decode(public_key).map_err(db_error)?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| "Ed25519 公钥长度无效".to_string())?;
    let signature_bytes = BASE64.decode(&manifest.signature).map_err(db_error)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(db_error)?;
    VerifyingKey::from_bytes(&key_bytes)
        .map_err(db_error)?
        .verify(manifest_signature_payload(manifest).as_bytes(), &signature)
        .map_err(|_| "词库更新清单签名无效".to_string())
}

fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |version: &str| {
        version
            .split(|character: char| !character.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let candidate_parts = parse(candidate);
    let current_parts = parse(current);
    if candidate_parts.is_empty() || current_parts.is_empty() {
        candidate > current
    } else {
        candidate_parts > current_parts
    }
}

fn current_dictionary_version(state: &AppState) -> Result<String, String> {
    state
        .dictionary
        .lock()
        .map_err(db_error)?
        .query_row(
            "SELECT value FROM dictionary_metadata WHERE key = 'version'",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn update_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .user_agent(concat!("plain-dictionary/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(db_error)
}

async fn download_limited(
    client: &reqwest::Client,
    url: &str,
    maximum_size: usize,
) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.map_err(db_error)?;
    if !response.status().is_success() {
        return Err(format!("下载失败，服务器返回 {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > maximum_size as u64)
    {
        return Err("下载文件超过大小限制".into());
    }
    let bytes = response.bytes().await.map_err(db_error)?;
    if bytes.len() > maximum_size {
        return Err("下载文件超过大小限制".into());
    }
    Ok(bytes.to_vec())
}

async fn fetch_update_manifest(
    manifest_url: &str,
    public_key: &str,
) -> Result<DictionaryUpdateManifest, String> {
    let url = reqwest::Url::parse(manifest_url).map_err(db_error)?;
    if url.scheme() != "https" {
        return Err("词库更新清单地址必须使用 HTTPS".into());
    }
    let bytes = download_limited(&update_http_client()?, manifest_url, MAX_MANIFEST_BYTES).await?;
    let manifest: DictionaryUpdateManifest = serde_json::from_slice(&bytes).map_err(db_error)?;
    verify_update_manifest(&manifest, public_key)?;
    Ok(manifest)
}

#[tauri::command]
async fn check_dictionary_update(
    state: State<'_, AppState>,
) -> Result<DictionaryUpdateInfo, String> {
    let current_version = current_dictionary_version(&state)?;
    let Some((manifest_url, public_key)) = update_configuration() else {
        return Ok(DictionaryUpdateInfo {
            configured: false,
            current_version,
            latest_version: None,
            published_at: None,
            download_size: None,
            update_available: false,
        });
    };
    let manifest = fetch_update_manifest(manifest_url, public_key).await?;
    Ok(DictionaryUpdateInfo {
        configured: true,
        update_available: is_newer_version(&manifest.dictionary_version, &current_version),
        current_version,
        latest_version: Some(manifest.dictionary_version),
        published_at: Some(manifest.published_at),
        download_size: Some(manifest.size),
    })
}

#[tauri::command]
async fn install_dictionary_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DictionaryUpdateInfo, String> {
    let (manifest_url, public_key) =
        update_configuration().ok_or_else(|| "当前构建未配置可信词库更新源".to_string())?;
    let current_version = current_dictionary_version(&state)?;
    let manifest = fetch_update_manifest(manifest_url, public_key).await?;
    if !is_newer_version(&manifest.dictionary_version, &current_version) {
        return Err("远端词库版本不高于当前版本，已拒绝安装".into());
    }

    let compressed = download_limited(
        &update_http_client()?,
        &manifest.url,
        MAX_DICTIONARY_DOWNLOAD_BYTES,
    )
    .await?;
    if compressed.len() as u64 != manifest.size {
        return Err("词库下载大小与清单不一致".into());
    }
    let actual_hash = hex::encode(Sha256::digest(&compressed));
    if actual_hash != manifest.sha256.to_lowercase() {
        return Err("词库下载文件的 SHA-256 校验失败".into());
    }

    let candidate = state.dictionary_path.with_extension("sqlite.download");
    let mut decoder =
        zstd::stream::read::Decoder::new(Cursor::new(compressed)).map_err(db_error)?;
    let mut decompressed = Vec::new();
    decoder
        .by_ref()
        .take((MAX_DICTIONARY_DOWNLOAD_BYTES + 1) as u64)
        .read_to_end(&mut decompressed)
        .map_err(db_error)?;
    if decompressed.len() > MAX_DICTIONARY_DOWNLOAD_BYTES {
        return Err("解压后的词库超过大小限制".into());
    }
    fs::write(&candidate, decompressed).map_err(db_error)?;
    let candidate_version = validate_dictionary(&candidate)?;
    if candidate_version != manifest.dictionary_version {
        let _ = fs::remove_file(&candidate);
        return Err("词库内部版本与更新清单不一致".into());
    }

    let placeholder = Connection::open_in_memory().map_err(db_error)?;
    let old_connection = {
        let mut dictionary = state.dictionary.lock().map_err(db_error)?;
        std::mem::replace(&mut *dictionary, placeholder)
    };
    old_connection
        .close()
        .map_err(|(_, error)| format!("关闭旧词库连接失败: {error}"))?;
    let install_result = install_dictionary_file(&candidate, &state.dictionary_path);
    let _ = fs::remove_file(&candidate);
    let reopened =
        Connection::open_with_flags(&state.dictionary_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(db_error)?;
    *state.dictionary.lock().map_err(db_error)? = reopened;
    install_result?;
    app.emit("dictionary-updated", &manifest.dictionary_version)
        .map_err(db_error)?;

    Ok(DictionaryUpdateInfo {
        configured: true,
        current_version: manifest.dictionary_version.clone(),
        latest_version: Some(manifest.dictionary_version),
        published_at: Some(manifest.published_at),
        download_size: Some(manifest.size),
        update_available: false,
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            migrate_legacy_app_data(&app_data).map_err(|error| error.to_string())?;
            fs::create_dir_all(&app_data)?;
            let dictionary_path = app_data.join("dictionary.sqlite");
            install_bundled_dictionary(app, &dictionary_path).map_err(|error| error.to_string())?;
            initialize_dictionary(&dictionary_path).map_err(|error| error.to_string())?;
            let dictionary =
                Connection::open_with_flags(&dictionary_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|error| error.to_string())?;
            let user = initialize_user_database(&app_data.join("user.sqlite"))
                .map_err(|error| error.to_string())?;
            let always_on_top: bool = user
                .query_row(
                    "SELECT value = 'true' FROM app_settings WHERE key = 'always_on_top'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(always_on_top)?;
            }
            app.manage(AppState {
                dictionary: Mutex::new(dictionary),
                user: Mutex::new(user),
                dictionary_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_entries,
            get_entry,
            record_query,
            get_recent_queries,
            get_query_stats,
            list_favorite_folders,
            create_favorite_folder,
            rename_favorite_folder,
            delete_favorite_folder,
            add_favorite,
            remove_favorite,
            get_settings,
            set_always_on_top,
            open_management_window,
            focus_main_window,
            dictionary_metadata,
            check_dictionary_update,
            install_dictionary_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Plain Dictionary");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "plain-dictionary-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        path
    }

    #[test]
    fn normalizes_english_case_and_whitespace() {
        assert_eq!(normalize_query("  Apple "), "apple");
    }

    #[test]
    fn keeps_chinese_query_content() {
        assert_eq!(normalize_query(" 苹果 "), "苹果");
    }

    #[test]
    fn compares_date_style_dictionary_versions() {
        assert!(is_newer_version("2026.06.22", "2026.06.21"));
        assert!(is_newer_version("2027.01", "2026.12.31"));
        assert!(!is_newer_version("2026.06.21", "2026.06.21"));
        assert!(!is_newer_version("2025.12", "2026.01"));
    }

    #[test]
    fn project_build_configures_trusted_update_source() {
        let (url, public_key) = update_configuration().expect("update source should be configured");
        assert_eq!(
            url,
            "https://github.com/Areson-LTQ/plain-dictionary/releases/download/dictionary-latest/dictionary-manifest.json"
        );
        assert_eq!(public_key, "f9auhCzb1iknc1nMRUZMo9TSWHoC6CMJOsIod6IJN5Q=");
    }

    #[test]
    fn verifies_signed_update_manifest_and_rejects_tampering() {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let public_key = BASE64.encode(signing_key.verifying_key().to_bytes());
        let mut manifest = DictionaryUpdateManifest {
            schema_version: 1,
            dictionary_version: "2026.06.22".into(),
            published_at: "2026-06-22T00:00:00Z".into(),
            url: "https://example.com/dictionary.sqlite.zst".into(),
            size: 1234,
            sha256: "ab".repeat(32),
            signature: String::new(),
        };
        manifest.signature = BASE64.encode(
            signing_key
                .sign(manifest_signature_payload(&manifest).as_bytes())
                .to_bytes(),
        );
        verify_update_manifest(&manifest, &public_key).expect("valid signature should pass");

        manifest.dictionary_version = "2026.06.23".into();
        assert!(verify_update_manifest(&manifest, &public_key).is_err());
    }

    #[test]
    fn bundled_dictionary_contains_full_dataset() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dictionary.sqlite");
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("bundled dictionary should open");
        let english_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM entries WHERE language = 'en'",
                [],
                |row| row.get(0),
            )
            .expect("English entry count should be available");
        assert!(english_count > 20_000, "bundled dictionary is incomplete");
    }

    #[test]
    fn migrates_legacy_user_database_without_losing_data() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "CREATE TABLE favorite_folders (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                   created_at TEXT NOT NULL
                 );
                 INSERT INTO favorite_folders(name, created_at) VALUES ('常用', '2026-01-01');",
            )
            .expect("legacy data should be created");

        migrate_user_database(&mut connection).expect("legacy database should migrate");

        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");
        let folder_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM favorite_folders", [], |row| {
                row.get(0)
            })
            .expect("folder count should be readable");
        let stats_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'query_stats'",
                [],
                |row| row.get(0),
            )
            .expect("new table should exist");
        assert_eq!(version, USER_SCHEMA_VERSION);
        assert_eq!(folder_count, 1);
        assert_eq!(stats_table_count, 1);
    }

    #[test]
    fn rejects_user_database_from_a_newer_app() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .pragma_update(None, "user_version", USER_SCHEMA_VERSION + 1)
            .expect("future version should be set");
        assert!(migrate_user_database(&mut connection).is_err());
    }

    #[test]
    fn safely_installs_and_recovers_dictionary_files() {
        let directory = temporary_directory("dictionary-install");
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dictionary.sqlite");
        let target = directory.join("dictionary.sqlite");
        initialize_dictionary(&target).expect("seed dictionary should be created");

        assert!(install_dictionary_file(&bundled, &target).expect("new dictionary should install"));
        assert!(!install_dictionary_file(&bundled, &target)
            .expect("same dictionary should not reinstall"));
        assert_eq!(
            validate_dictionary(&target).expect("installed dictionary should be valid"),
            "freedict-eng-zho-2025.11.23"
        );

        let backup = target.with_extension("sqlite.backup");
        rename_dictionary_file(&target, &backup).expect("backup should be simulated");
        recover_dictionary_backup(&target).expect("backup should recover");
        assert!(target.exists());
        assert!(!backup.exists());
        fs::remove_dir_all(directory).expect("temporary files should be removed");
    }

    #[test]
    fn migrates_files_from_legacy_identifier_directory() {
        let parent = temporary_directory("identifier-migration");
        let legacy = parent.join(LEGACY_IDENTIFIER);
        let current = parent.join("com.plaindictionary.desktop");
        fs::create_dir_all(&legacy).expect("legacy directory should be created");
        fs::create_dir_all(&current).expect("current directory should be created");
        fs::write(legacy.join("user.sqlite"), b"test data")
            .expect("legacy user data should be created");

        migrate_legacy_app_data(&current).expect("legacy app data should migrate");

        assert_eq!(
            fs::read(current.join("user.sqlite")).expect("migrated data should exist"),
            b"test data"
        );
        assert!(!legacy.exists());
        fs::remove_dir_all(parent).expect("temporary files should be removed");
    }
}
