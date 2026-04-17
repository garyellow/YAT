use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

const HISTORY_BUSY_TIMEOUT_MS: u64 = 5_000;

/// Parse an RFC 3339 string into `DateTime<Utc>`, logging a warning on failure.
fn parse_datetime(raw: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(raw)
        .unwrap_or_else(|e| {
            log::warn!("invalid datetime in history DB: {raw:?}: {e}");
            DateTime::default()
        })
        .with_timezone(&Utc)
}

#[derive(Error, Debug)]
pub enum HistoryError {
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub raw_text: String,
    pub polished_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub duration_seconds: f64,
    pub status: String,
    /// Application that was active when recording started (for per-app context).
    #[serde(default)]
    pub app_name: Option<String>,
    /// Window title at recording start (e.g. "Tab Title - Google Chrome").
    #[serde(default)]
    pub window_title: Option<String>,
    /// Path to the saved audio WAV file, if retained.
    #[serde(default)]
    pub audio_path: Option<String>,
}

pub struct HistoryManager {
    conn: Connection,
}

impl HistoryManager {
    pub fn new(db_path: PathBuf) -> Result<Self, HistoryError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        Self::configure_connection(&conn, true)?;
        Self::init_tables(conn)
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, HistoryError> {
        let conn = Connection::open_in_memory()?;
        Self::configure_connection(&conn, false)?;
        Self::init_tables(conn)
    }

    fn configure_connection(conn: &Connection, prefer_wal: bool) -> Result<(), HistoryError> {
        conn.busy_timeout(Duration::from_millis(HISTORY_BUSY_TIMEOUT_MS))?;
        conn.execute_batch("PRAGMA synchronous = FULL;")?;

        if prefer_wal {
            let journal_mode: String = conn.query_row("PRAGMA journal_mode = WAL;", [], |row| {
                row.get(0)
            })?;

            if !journal_mode.eq_ignore_ascii_case("wal") {
                log::warn!(
                    "history database did not enter WAL mode; continuing with journal_mode={journal_mode}"
                );
            }
        }

        Ok(())
    }

    fn init_tables(conn: Connection) -> Result<Self, HistoryError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id              TEXT PRIMARY KEY,
                raw_text        TEXT NOT NULL,
                polished_text   TEXT,
                created_at      TEXT NOT NULL,
                duration_seconds REAL NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'success',
                app_name        TEXT,
                window_title    TEXT,
                audio_path      TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);",
        )?;

        // Migrate existing databases: add new columns if they don't exist yet.
        for col in ["window_title", "audio_path"] {
            let add_sql = format!("ALTER TABLE history ADD COLUMN {col} TEXT");
            // Ignore "duplicate column" errors — they mean migration already ran.
            if let Err(e) = conn.execute_batch(&add_sql) {
                let msg = e.to_string();
                if !msg.contains("duplicate column") {
                    return Err(HistoryError::Db(e));
                }
            }
        }

        Ok(Self { conn })
    }

    pub fn insert(&self, entry: &HistoryEntry) -> Result<(), HistoryError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO history (id, raw_text, polished_text, created_at, duration_seconds, status, app_name, window_title, audio_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.id,
                entry.raw_text,
                entry.polished_text,
                entry.created_at.to_rfc3339(),
                entry.duration_seconds,
                entry.status,
                entry.app_name,
                entry.window_title,
                entry.audio_path,
            ],
        )?;
        Ok(())
    }

    pub fn search(
        &self,
        query: Option<&str>,
        limit: u32,
    ) -> Result<Vec<HistoryEntry>, HistoryError> {
        let mut entries = Vec::new();

        if let Some(q) = query {
            if !q.is_empty() {
                // Escape SQL LIKE special characters
                let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
                let pattern = format!("%{escaped}%");
                let mut stmt = self.conn.prepare(
                    "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name, window_title, audio_path
                     FROM history
                     WHERE raw_text LIKE ?1 ESCAPE '\\' OR polished_text LIKE ?1 ESCAPE '\\'
                     ORDER BY created_at DESC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![pattern, limit], |row| {
                    Ok(HistoryEntry {
                        id: row.get(0)?,
                        raw_text: row.get(1)?,
                        polished_text: row.get(2)?,
                        created_at: parse_datetime(&row.get::<_, String>(3)?),
                        duration_seconds: row.get(4)?,
                        status: row.get(5)?,
                        app_name: row.get(6)?,
                        window_title: row.get(7)?,
                        audio_path: row.get(8)?,
                    })
                })?;
                for row in rows {
                    entries.push(row?);
                }
                return Ok(entries);
            }
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name, window_title, audio_path
             FROM history
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                raw_text: row.get(1)?,
                polished_text: row.get(2)?,
                created_at: parse_datetime(&row.get::<_, String>(3)?),
                duration_seconds: row.get(4)?,
                status: row.get(5)?,
                app_name: row.get(6)?,
                window_title: row.get(7)?,
                audio_path: row.get(8)?,
            })
        })?;
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    /// Delete entry and return its audio_path (if any) so the caller can
    /// remove the file from disk.
    pub fn delete(&self, id: &str) -> Result<Option<String>, HistoryError> {
        let audio_path: Option<String> = self
            .conn
            .query_row(
                "SELECT audio_path FROM history WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        self.conn
            .execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(audio_path)
    }

    pub fn clear_old(&self, retention_hours: u32) -> Result<u64, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::hours(retention_hours as i64);
        let deleted = self.conn.execute(
            "DELETE FROM history WHERE created_at < ?1",
            params![cutoff.to_rfc3339()],
        )?;
        Ok(deleted as u64)
    }

    /// Delete entries older than the configured retention window and return
    /// any associated audio file paths so the caller can remove them from disk.
    pub fn clear_old_with_audio_paths(
        &self,
        retention_hours: u32,
    ) -> Result<(u64, Vec<String>), HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::hours(retention_hours as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let mut stmt = self.conn.prepare(
            "SELECT audio_path FROM history WHERE audio_path IS NOT NULL AND created_at < ?1",
        )?;
        let paths = stmt
            .query_map(params![&cutoff_str], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let deleted = self.conn.execute(
            "DELETE FROM history WHERE created_at < ?1",
            params![cutoff_str],
        )?;

        Ok((deleted as u64, paths))
    }

    /// Collect audio_path values for entries whose audio has expired, then NULL
    /// them out in the database.  The caller is responsible for deleting the
    /// actual files.
    pub fn expire_audio_paths(&self, audio_retention_hours: u32) -> Result<Vec<String>, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::hours(audio_retention_hours as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let mut stmt = self.conn.prepare(
            "SELECT audio_path FROM history WHERE audio_path IS NOT NULL AND created_at < ?1",
        )?;
        let paths = stmt
            .query_map(params![cutoff_str], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        if !paths.is_empty() {
            self.conn.execute(
                "UPDATE history SET audio_path = NULL WHERE audio_path IS NOT NULL AND created_at < ?1",
                params![cutoff_str],
            )?;
        }

        Ok(paths)
    }

    pub fn clear_all(&self) -> Result<u64, HistoryError> {
        let deleted = self.conn.execute("DELETE FROM history", [])?;
        Ok(deleted as u64)
    }

    /// Delete all entries and return any associated audio file paths so the
    /// caller can remove them from disk.
    pub fn clear_all_with_audio_paths(&self) -> Result<(u64, Vec<String>), HistoryError> {
        let mut stmt = self
            .conn
            .prepare("SELECT audio_path FROM history WHERE audio_path IS NOT NULL")?;
        let paths = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let deleted = self.conn.execute("DELETE FROM history", [])?;
        Ok((deleted as u64, paths))
    }

    /// Get recent context filtered to a specific application and optional
    /// window title. When `window_title` is provided, only entries matching
    /// both `app_name` AND `window_title` are returned. When it is `None`,
    /// entries matching `app_name` (regardless of title) are returned.
    ///
    /// No fallback: if nothing matches, an empty `Vec` is returned — the
    /// caller should treat this as a fresh conversation with no prior context.
    pub fn recent_context_for_app(
        &self,
        minutes: u32,
        app_name: &str,
        window_title: Option<&str>,
    ) -> Result<Vec<String>, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::minutes(minutes as i64);

        if let Some(title) = window_title {
            let mut stmt = self.conn.prepare(
                "SELECT COALESCE(polished_text, raw_text)
                 FROM history
                 WHERE created_at >= ?1 AND status = 'success'
                   AND app_name = ?2 AND window_title = ?3
                 ORDER BY created_at DESC
                 LIMIT 5",
            )?;
            let rows = stmt.query_map(params![cutoff.to_rfc3339(), app_name, title], |row| {
                row.get::<_, String>(0)
            })?;
            let mut results = Vec::new();
            for row in rows {
                results.push(row?);
            }
            Ok(results)
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT COALESCE(polished_text, raw_text)
                 FROM history
                 WHERE created_at >= ?1 AND status = 'success' AND app_name = ?2
                 ORDER BY created_at DESC
                 LIMIT 5",
            )?;
            let rows = stmt.query_map(params![cutoff.to_rfc3339(), app_name], |row| {
                row.get::<_, String>(0)
            })?;
            let mut results = Vec::new();
            for row in rows {
                results.push(row?);
            }
            Ok(results)
        }
    }

    pub fn get_by_id(&self, id: &str) -> Result<Option<HistoryEntry>, HistoryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name, window_title, audio_path
             FROM history WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                raw_text: row.get(1)?,
                polished_text: row.get(2)?,
                created_at: parse_datetime(&row.get::<_, String>(3)?),
                duration_seconds: row.get(4)?,
                status: row.get(5)?,
                app_name: row.get(6)?,
                window_title: row.get(7)?,
                audio_path: row.get(8)?,
            })
        })?;
        match rows.next() {
            Some(Ok(entry)) => Ok(Some(entry)),
            Some(Err(e)) => Err(HistoryError::Db(e)),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_entry(id: &str, raw: &str, polished: Option<&str>, status: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            raw_text: raw.into(),
            polished_text: polished.map(String::from),
            created_at: Utc::now(),
            duration_seconds: 1.5,
            status: status.into(),
            app_name: None,
            window_title: None,
            audio_path: None,
        }
    }

    #[test]
    fn insert_and_get_by_id() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        let entry = make_entry("a1", "hello world", Some("Hello, world."), "success");
        mgr.insert(&entry).unwrap();

        let fetched = mgr.get_by_id("a1").unwrap().expect("should exist");
        assert_eq!(fetched.raw_text, "hello world");
        assert_eq!(fetched.polished_text.as_deref(), Some("Hello, world."));
        assert_eq!(fetched.status, "success");
    }

    #[test]
    fn get_by_id_missing_returns_none() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        assert!(mgr.get_by_id("nonexistent").unwrap().is_none());
    }

    #[test]
    fn search_returns_matching() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        mgr.insert(&make_entry("s1", "apple pie", None, "success")).unwrap();
        mgr.insert(&make_entry("s2", "banana split", None, "success")).unwrap();

        let results = mgr.search(Some("apple"), 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "s1");

        // Empty query returns all
        let all = mgr.search(None, 100).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn search_escapes_sql_wildcards() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        mgr.insert(&make_entry("w1", "100% done", None, "success")).unwrap();
        mgr.insert(&make_entry("w2", "nothing here", None, "success")).unwrap();

        let results = mgr.search(Some("100%"), 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "w1");
    }

    #[test]
    fn delete_removes_entry() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        mgr.insert(&make_entry("d1", "to delete", None, "success")).unwrap();
        mgr.delete("d1").unwrap();
        assert!(mgr.get_by_id("d1").unwrap().is_none());
    }

    #[test]
    fn clear_old_respects_retention() {
        let mgr = HistoryManager::new_in_memory().unwrap();

        let mut old = make_entry("old1", "old entry", None, "success");
        old.created_at = Utc::now() - Duration::hours(50);
        mgr.insert(&old).unwrap();

        let recent = make_entry("new1", "new entry", None, "success");
        mgr.insert(&recent).unwrap();

        let deleted = mgr.clear_old(48).unwrap();
        assert_eq!(deleted, 1);
        assert!(mgr.get_by_id("old1").unwrap().is_none());
        assert!(mgr.get_by_id("new1").unwrap().is_some());
    }

    #[test]
    fn clear_old_with_audio_paths_returns_deleted_audio() {
        let mgr = HistoryManager::new_in_memory().unwrap();

        let mut old = make_entry("old-audio", "old entry", None, "success");
        old.created_at = Utc::now() - Duration::hours(50);
        old.audio_path = Some("/tmp/old.wav".into());
        mgr.insert(&old).unwrap();

        let mut recent = make_entry("new-audio", "new entry", None, "success");
        recent.audio_path = Some("/tmp/new.wav".into());
        mgr.insert(&recent).unwrap();

        let (deleted, paths) = mgr.clear_old_with_audio_paths(48).unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(paths, vec!["/tmp/old.wav"]);
        assert!(mgr.get_by_id("old-audio").unwrap().is_none());
        assert!(mgr.get_by_id("new-audio").unwrap().is_some());
    }

    #[test]
    fn clear_all_with_audio_paths_returns_all_audio() {
        let mgr = HistoryManager::new_in_memory().unwrap();

        let mut first = make_entry("a1", "first", None, "success");
        first.audio_path = Some("/tmp/first.wav".into());
        mgr.insert(&first).unwrap();

        let second = make_entry("a2", "second", None, "success");
        mgr.insert(&second).unwrap();

        let mut third = make_entry("a3", "third", None, "success");
        third.audio_path = Some("/tmp/third.wav".into());
        mgr.insert(&third).unwrap();

        let (deleted, paths) = mgr.clear_all_with_audio_paths().unwrap();
        assert_eq!(deleted, 3);
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"/tmp/first.wav".to_string()));
        assert!(paths.contains(&"/tmp/third.wav".to_string()));
        assert!(mgr.get_by_id("a1").unwrap().is_none());
        assert!(mgr.get_by_id("a2").unwrap().is_none());
        assert!(mgr.get_by_id("a3").unwrap().is_none());
    }

    #[test]
    fn recent_context_only_success() {
        let mgr = HistoryManager::new_in_memory().unwrap();

        let mut good = make_entry("c1", "good text", Some("Good text."), "success");
        good.app_name = Some("TestApp".into());
        mgr.insert(&good).unwrap();

        let mut bad = make_entry("c2", "", Some("[Error] something"), "error");
        bad.app_name = Some("TestApp".into());
        mgr.insert(&bad).unwrap();

        let ctx = mgr.recent_context_for_app(60, "TestApp", None).unwrap();
        assert_eq!(ctx.len(), 1);
        assert_eq!(ctx[0], "Good text.");
    }

    #[test]
    fn insert_or_replace_updates_existing() {
        let mgr = HistoryManager::new_in_memory().unwrap();
        mgr.insert(&make_entry("r1", "original", None, "success")).unwrap();

        let mut updated = make_entry("r1", "original", Some("Polished."), "success");
        updated.duration_seconds = 2.0;
        mgr.insert(&updated).unwrap();

        let fetched = mgr.get_by_id("r1").unwrap().unwrap();
        assert_eq!(fetched.polished_text.as_deref(), Some("Polished."));
    }

    #[test]
    fn new_creates_parent_directory() {
        let root = std::env::temp_dir().join(format!("yat-history-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("nested").join("history.db");

        assert!(!db_path.parent().expect("parent dir").exists());

        let _mgr = HistoryManager::new(db_path.clone()).expect("history DB should initialize");

        assert!(db_path.parent().expect("parent dir").exists());
        assert!(db_path.exists());

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn new_configures_file_backed_connection_for_wal_and_busy_timeout() {
        let root = std::env::temp_dir().join(format!("yat-history-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("history.db");

        let mgr = HistoryManager::new(db_path).expect("history DB should initialize");

        let journal_mode: String = mgr
            .conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("should read journal mode");
        let busy_timeout: i64 = mgr
            .conn
            .query_row("PRAGMA busy_timeout;", [], |row| row.get(0))
            .expect("should read busy timeout");

        assert_eq!(journal_mode.to_lowercase(), "wal");
        assert_eq!(busy_timeout, HISTORY_BUSY_TIMEOUT_MS as i64);

        std::fs::remove_dir_all(root).ok();
    }
}
