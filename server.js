require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

let dbModule;
async function getDbModule() {
    if (!dbModule) {
        const { getDb, query, run } = require('./db');
        await getDb();
        dbModule = { query, run };
    }
    return dbModule;
}

// ── GET /api/snapshots ──
app.get('/api/snapshots', async (req, res) => {
    try {
        const { query } = await getDbModule();
        const limit = parseInt(req.query.limit) || 15;
        const rows = query(`
            SELECT id, snapshot_date, total_vulnerabilities, total_remediations, total_equipment
            FROM snapshots ORDER BY snapshot_date DESC LIMIT ?
        `, [limit]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener snapshots' });
    }
});

// ── GET /api/snapshots/latest ──
app.get('/api/snapshots/latest', async (req, res) => {
    try {
        const { query } = await getDbModule();

        const snapshots = query(`
            SELECT id, snapshot_date, total_vulnerabilities, total_remediations, total_equipment
            FROM snapshots ORDER BY snapshot_date DESC LIMIT 2
        `);

        if (snapshots.length === 0) return res.json(null);

        const current = snapshots[0];
        const previous = snapshots[1] || null;

        const top5Remediations = query(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `, [current.id]);

        const top5Equipment = query(`
            SELECT name, vulnerabilities
            FROM equipment WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `, [current.id]);

        let prevRemediations = [], prevEquipment = [];
        if (previous) {
            prevRemediations = query(`
                SELECT remediation, vulnerabilities FROM remediations
                WHERE snapshot_id = ? ORDER BY vulnerabilities DESC LIMIT 5
            `, [previous.id]);
            prevEquipment = query(`
                SELECT name, vulnerabilities FROM equipment
                WHERE snapshot_id = ? ORDER BY vulnerabilities DESC LIMIT 5
            `, [previous.id]);
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

// ── GET /api/snapshots/:id/all ──
app.get('/api/snapshots/:id/all', async (req, res) => {
    try {
        const { query } = await getDbModule();
        const sid = parseInt(req.params.id);

        const remediations = query(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC
        `, [sid]);

        const equipment = query(`
            SELECT name, vulnerabilities FROM equipment
            WHERE snapshot_id = ? ORDER BY vulnerabilities DESC
        `, [sid]);

        res.json({ remediations, equipment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos completos' });
    }
});

// ── POST /api/snapshots ──
app.post('/api/snapshots', async (req, res) => {
    const { date, remediations, equipment } = req.body;
    if (!date || !remediations || !Array.isArray(remediations)) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    try {
        const { query, run, saveDb } = require('./db');
        await getDbModule();

        const totalVulns = remediations.reduce((s, r) => s + (r.vulnerabilities || 0), 0);

        // Borrar snapshot del mismo día si existe
        const existing = query('SELECT id FROM snapshots WHERE snapshot_date = ?', [date]);
        if (existing.length > 0) {
            run('DELETE FROM remediations WHERE snapshot_id = ?', [existing[0].id]);
            run('DELETE FROM equipment WHERE snapshot_id = ?', [existing[0].id]);
            run('DELETE FROM snapshots WHERE id = ?', [existing[0].id]);
        }

        // Insertar snapshot
        run(`INSERT INTO snapshots (snapshot_date, total_vulnerabilities, total_remediations, total_equipment)
             VALUES (?, ?, ?, ?)`,
            [date, totalVulns, remediations.length, (equipment || []).length]);

        const snap = query('SELECT id FROM snapshots WHERE snapshot_date = ? ORDER BY id DESC LIMIT 1', [date]);
        const snapshotId = snap[0].id;

        for (const r of remediations) {
            run(`INSERT INTO remediations (snapshot_id, remediation, description, vulnerabilities)
                 VALUES (?, ?, ?, ?)`,
                [snapshotId, r.remediation || '', r.description || '', r.vulnerabilities || 0]);
        }

        for (const e of (equipment || [])) {
            run(`INSERT INTO equipment (snapshot_id, name, vulnerabilities) VALUES (?, ?, ?)`,
                [snapshotId, e.name || '', e.vulnerabilities || 0]);
        }

        res.json({ success: true, snapshotId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar datos' });
    }
});

const PORT = process.env.PORT || 8080;

(async () => {
    await getDbModule();
    app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
})();
