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
}

pub struct HistoryManager {
    conn: Connection,
}

impl HistoryManager {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, HistoryError> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let db_path = app_data_dir.join("history.db");
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id              TEXT PRIMARY KEY,
                raw_text        TEXT NOT NULL,
                polished_text   TEXT,
                created_at      TEXT NOT NULL,
                duration_seconds REAL NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'success'
            );
            CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);",
        )?;

        Ok(Self { conn })
    }

    pub fn insert(&self, entry: &HistoryEntry) -> Result<(), HistoryError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO history (id, raw_text, polished_text, created_at, duration_seconds, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry.id,
                entry.raw_text,
                entry.polished_text,
                entry.created_at.to_rfc3339(),
                entry.duration_seconds,
                entry.status,
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
                    "SELECT id, raw_text, polished_text, created_at, duration_seconds, status
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
                    })
                })?;
                for row in rows {
                    entries.push(row?);
                }
                return Ok(entries);
            }
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status
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

    pub fn get_by_id(&self, id: &str) -> Result<Option<HistoryEntry>, HistoryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, raw_text, polished_text, created_at, duration_seconds, status
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
            })
        })?;
        match rows.next() {
            Some(Ok(entry)) => Ok(Some(entry)),
            _ => Ok(None),
        }
    }
}
