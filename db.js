const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vulnerabilidades.db');

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        initSchema();
    }
    return db;
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date         TEXT NOT NULL,
            created_at            TEXT DEFAULT (datetime('now')),
            total_vulnerabilities INTEGER DEFAULT 0,
            total_remediations    INTEGER DEFAULT 0,
            total_equipment       INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS remediations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id     INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
            remediation     TEXT,
            description     TEXT,
            vulnerabilities INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS equipment (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id     INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
            name            TEXT,
            vulnerabilities INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS ix_remediations_snapshot ON remediations(snapshot_id, vulnerabilities DESC);
        CREATE INDEX IF NOT EXISTS ix_equipment_snapshot    ON equipment(snapshot_id, vulnerabilities DESC);
        CREATE INDEX IF NOT EXISTS ix_snapshots_date        ON snapshots(snapshot_date DESC);
    `);
}

module.exports = { getDb };
