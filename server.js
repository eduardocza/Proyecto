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
            SELECT id, name, vulnerabilities, support_status
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
            SELECT id, name, vulnerabilities, support_status
            FROM equipment WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC
        `, [sid]);

        res.json({ remediations, equipment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos completos' });
    }
});

// ── PATCH /api/equipment/:id/status ── actualizar estado de soporte
app.patch('/api/equipment/:id/status', async (req, res) => {
    try {
        const { run } = await getDbModule();
        const { status } = req.body;
        const validStatuses = ['Sin asignar', 'Correo enviado', 'Horario confirmado', 'En atención', 'Completado', 'Pospuesto'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }
        run('UPDATE equipment SET support_status = ? WHERE id = ?', [status, parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// ── POST /api/manual ── entrada manual de datos históricos
app.post('/api/manual', async (req, res) => {
    const { date, total_vulnerabilities } = req.body;
    if (!date || total_vulnerabilities === undefined) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }
    try {
        const { query, run } = await getDbModule();

        // Verificar si ya existe snapshot completo para esa fecha
        const existing = query('SELECT id FROM snapshots WHERE snapshot_date = ?', [date]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Ya existe un snapshot para esa fecha' });
        }

        // Insertar o reemplazar en manual_snapshots
        run(`INSERT OR REPLACE INTO manual_snapshots (snapshot_date, total_vulnerabilities)
             VALUES (?, ?)`, [date, parseInt(total_vulnerabilities)]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar registro manual' });
    }
});

// ── GET /api/history ── combina snapshots reales + manuales para las gráficas
app.get('/api/history', async (req, res) => {
    try {
        const { query } = await getDbModule();
        const limit = parseInt(req.query.limit) || 30;

        const real = query(`
            SELECT snapshot_date, total_vulnerabilities, 'real' as type
            FROM snapshots ORDER BY snapshot_date DESC LIMIT ?
        `, [limit]);

        const manual = query(`
            SELECT snapshot_date, total_vulnerabilities, 'manual' as type
            FROM manual_snapshots ORDER BY snapshot_date DESC LIMIT ?
        `, [limit]);

        // Combinar, eliminar duplicados (real tiene prioridad), ordenar por fecha
        const map = new Map();
        [...manual, ...real].forEach(r => map.set(r.snapshot_date, r));
        const combined = [...map.values()].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

        res.json(combined);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// ── GET /api/weekly-report ── datos para el reporte semanal PDF
app.get('/api/weekly-report', async (req, res) => {
    try {
        const { query } = await getDbModule();
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'Parámetros from y to requeridos' });

        // Snapshots de la semana ordenados por fecha
        const snapshots = query(`
            SELECT id, snapshot_date, total_vulnerabilities
            FROM snapshots WHERE snapshot_date BETWEEN ? AND ?
            ORDER BY snapshot_date ASC
        `, [from, to]);

        if (snapshots.length === 0) return res.json({ snapshots: [], first: null, last: null, completedEquipment: [] });

        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];

        // Top 5 remediaciones del primer día
        const firstTop5 = query(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `, [first.id]);

        // Top 5 remediaciones del último día
        const lastTop5 = query(`
            SELECT remediation, description, vulnerabilities
            FROM remediations WHERE snapshot_id = ?
            ORDER BY vulnerabilities DESC LIMIT 5
        `, [last.id]);

        // Movimiento diario de las 5 remediaciones del primer día
        const firstRemNames = firstTop5.map(r => r.remediation);
        const dailyMovement = [];
        for (const snap of snapshots) {
            const dayData = { date: snap.snapshot_date, total: snap.total_vulnerabilities, remediations: [] };
            for (const name of firstRemNames) {
                const row = query(`
                    SELECT vulnerabilities FROM remediations
                    WHERE snapshot_id = ? AND remediation = ? LIMIT 1
                `, [snap.id, name]);
                dayData.remediations.push({ name, vulnerabilities: row.length > 0 ? row[0].vulnerabilities : null });
            }
            dailyMovement.push(dayData);
        }

        // Equipos completados durante la semana (status = Completado en el último snapshot)
        const completedEquipment = query(`
            SELECT name, vulnerabilities, support_status
            FROM equipment WHERE snapshot_id = ? AND support_status = 'Completado'
            ORDER BY vulnerabilities DESC
        `, [last.id]);

        res.json({
            snapshots,
            first: { ...first, top5: firstTop5 },
            last: { ...last, top5: lastTop5 },
            dailyMovement,
            completedEquipment
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al generar reporte' });
    }
});


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
