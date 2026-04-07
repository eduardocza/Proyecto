const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vulnerabilidades.db');

let db;

async function getDb() {
    if (db) return db;

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    initSchema();
    return db;
}

function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

function initSchema() {
    db.run(`
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
            snapshot_id     INTEGER NOT NULL,
            remediation     TEXT,
            description     TEXT,
            vulnerabilities INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS equipment (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id     INTEGER NOT NULL,
            name            TEXT,
            vulnerabilities INTEGER DEFAULT 0,
            support_status  TEXT DEFAULT 'Sin asignar'
        );

        CREATE TABLE IF NOT EXISTS manual_snapshots (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date         TEXT NOT NULL UNIQUE,
            total_vulnerabilities INTEGER DEFAULT 0,
            created_at            TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS ix_remediations_snapshot ON remediations(snapshot_id, vulnerabilities DESC);
        CREATE INDEX IF NOT EXISTS ix_equipment_snapshot    ON equipment(snapshot_id, vulnerabilities DESC);
        CREATE INDEX IF NOT EXISTS ix_snapshots_date        ON snapshots(snapshot_date DESC);
    `);
    saveDb();
}

function query(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function run(sql, params = []) {
    db.run(sql, params);
    saveDb();
}

module.exports = { getDb, query, run, saveDb };
