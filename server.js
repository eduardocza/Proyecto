require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// ── GET /api/snapshots ── últimos N snapshots para las gráficas
app.get('/api/snapshots', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 15;
        const db = getDb();
        const rows = db.prepare(`
            SELECT id, snapshot_date, total_vulnerabilities, total_remediations, total_equipment
            FROM snapshots
            ORDER BY snapshot_date DESC
            LIMIT ?
        `).all(limit);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener snapshots' });
    }
});

// ── GET /api/snapshots/latest ── snapshot más reciente con top5
app.get('/api/snapshots/latest', (req, res) => {
    try {
        const db = getDb();

        const snapshots = db.prepare(`
            SELECT id, snapshot_date, total_vulnerabilities, total_remediations, total_equipment
            FROM snapshots
            ORDER BY snapshot_date DESC
            LIMIT 2
        `).all();

        if (snapshots.length === 0) return res.json(null);

        const current = snapshots[0];
        const previous = snapshots[1] || null;

        const top5Remediations = db.prepare(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `).all(current.id);

        const top5Equipment = db.prepare(`
            SELECT name, vulnerabilities
            FROM equipment WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `).all(current.id);

        let prevRemediations = [], prevEquipment = [];
        if (previous) {
            prevRemediations = db.prepare(`
                SELECT remediation, vulnerabilities
                FROM remediations WHERE snapshot_id = ?
                ORDER BY vulnerabilities DESC LIMIT 5
            `).all(previous.id);
            prevEquipment = db.prepare(`
                SELECT name, vulnerabilities
                FROM equipment WHERE snapshot_id = ?
                ORDER BY vulnerabilities DESC LIMIT 5
            `).all(previous.id);
        }

        res.json({
            current: { ...current, top5Remediations, top5Equipment },
            previous: previous ? { ...previous, top5Remediations: prevRemediations, top5Equipment: prevEquipment } : null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

// ── GET /api/snapshots/:id/all ── todas las filas para el modal
app.get('/api/snapshots/:id/all', (req, res) => {
    try {
        const db = getDb();
        const sid = parseInt(req.params.id);

        const remediations = db.prepare(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC
        `).all(sid);

        const equipment = db.prepare(`
            SELECT name, vulnerabilities
            FROM equipment WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC
        `).all(sid);

        res.json({ remediations, equipment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos completos' });
    }
});

// ── POST /api/snapshots ── guardar nuevo snapshot
app.post('/api/snapshots', (req, res) => {
    const { date, remediations, equipment } = req.body;

    if (!date || !remediations || !Array.isArray(remediations)) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    try {
        const db = getDb();
        const totalVulns = remediations.reduce((s, r) => s + (r.vulnerabilities || 0), 0);

        const insert = db.transaction(() => {
            // Borrar snapshot del mismo día si existe
            const existing = db.prepare('SELECT id FROM snapshots WHERE snapshot_date = ?').get(date);
            if (existing) {
                db.prepare('DELETE FROM snapshots WHERE id = ?').run(existing.id);
            }

            // Insertar snapshot
            const snap = db.prepare(`
                INSERT INTO snapshots (snapshot_date, total_vulnerabilities, total_remediations, total_equipment)
                VALUES (?, ?, ?, ?)
            `).run(date, totalVulns, remediations.length, (equipment || []).length);

            const snapshotId = snap.lastInsertRowid;

            // Insertar remediaciones
            const insRem = db.prepare(`
                INSERT INTO remediations (snapshot_id, remediation, description, vulnerabilities)
                VALUES (?, ?, ?, ?)
            `);
            for (const r of remediations) {
                insRem.run(snapshotId, r.remediation || '', r.description || '', r.vulnerabilities || 0);
            }

            // Insertar equipos
            const insEq = db.prepare(`
                INSERT INTO equipment (snapshot_id, name, vulnerabilities)
                VALUES (?, ?, ?)
            `);
            for (const e of (equipment || [])) {
                insEq.run(snapshotId, e.name || '', e.vulnerabilities || 0);
            }

            return snapshotId;
        });

        const snapshotId = insert();
        res.json({ success: true, snapshotId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar datos' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
