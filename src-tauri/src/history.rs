use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

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
        Self::init_tables(conn)
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, HistoryError> {
        let conn = Connection::open_in_memory()?;
        Self::init_tables(conn)
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
                app_name        TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);",
        )?;

        // Migration: add app_name column for databases created before this version.
        // Ignore only the expected duplicate-column error and surface everything else.
        match conn.execute_batch("ALTER TABLE history ADD COLUMN app_name TEXT;") {
            Ok(()) => log::info!("history migration applied: added app_name column"),
            Err(rusqlite::Error::SqliteFailure(_, Some(message)))
                if message.contains("duplicate column name: app_name") =>
            {
                log::debug!("history migration skipped: app_name column already exists");
            }
            Err(error) => return Err(HistoryError::Db(error)),
        }

        Ok(Self { conn })
    }

    pub fn insert(&self, entry: &HistoryEntry) -> Result<(), HistoryError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO history (id, raw_text, polished_text, created_at, duration_seconds, status, app_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                entry.id,
                entry.raw_text,
                entry.polished_text,
                entry.created_at.to_rfc3339(),
                entry.duration_seconds,
                entry.status,
                entry.app_name,
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
                    "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name
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
                    })
                })?;
                for row in rows {
                    entries.push(row?);
                }
                return Ok(entries);
            }
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name
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
            })
        })?;
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    pub fn delete(&self, id: &str) -> Result<(), HistoryError> {
        self.conn
            .execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_old(&self, retention_hours: u32) -> Result<u64, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::hours(retention_hours as i64);
        let deleted = self.conn.execute(
            "DELETE FROM history WHERE created_at < ?1",
            params![cutoff.to_rfc3339()],
        )?;
        Ok(deleted as u64)
    }

    /// Get polished (or raw) text from recent entries for LLM context.
    pub fn recent_context(&self, minutes: u32) -> Result<Vec<String>, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::minutes(minutes as i64);
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(polished_text, raw_text)
             FROM history
             WHERE created_at >= ?1 AND status = 'success'
             ORDER BY created_at DESC
             LIMIT 5",
        )?;
        let rows = stmt.query_map(params![cutoff.to_rfc3339()], |row| row.get::<_, String>(0))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get recent context filtered to a specific application.
    ///
    /// When the user is dictating inside an app, this provides the LLM with
    /// only the recent transcriptions from that same app, giving more
    /// relevant context than the unfiltered `recent_context()`.
    pub fn recent_context_for_app(
        &self,
        minutes: u32,
        app_name: &str,
    ) -> Result<Vec<String>, HistoryError> {
        let cutoff = Utc::now() - chrono::Duration::minutes(minutes as i64);
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

    pub fn get_by_id(&self, id: &str) -> Result<Option<HistoryEntry>, HistoryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status, app_name
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
    fn recent_context_only_success() {
        let mgr = HistoryManager::new_in_memory().unwrap();

        mgr.insert(&make_entry("c1", "good text", Some("Good text."), "success")).unwrap();
        mgr.insert(&make_entry("c2", "", Some("[Error] something"), "error")).unwrap();

        let ctx = mgr.recent_context(60).unwrap();
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
}
