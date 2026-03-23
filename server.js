require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getPool, sql } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// ── GET /api/snapshots ── últimos N snapshots para las gráficas
app.get('/api/snapshots', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 15;
        const pool = await getPool();
        const result = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit)
                    id, snapshot_date, total_vulnerabilities,
                    total_remediations, total_equipment
                FROM snapshots
                ORDER BY snapshot_date DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener snapshots' });
    }
});

// ── GET /api/snapshots/latest ── snapshot más reciente con top5
app.get('/api/snapshots/latest', async (req, res) => {
    try {
        const pool = await getPool();

        const snapResult = await pool.request().query(`
            SELECT TOP 2
                id, snapshot_date, total_vulnerabilities,
                total_remediations, total_equipment
            FROM snapshots
            ORDER BY snapshot_date DESC
        `);

        if (snapResult.recordset.length === 0) {
            return res.json(null);
        }

        const current = snapResult.recordset[0];
        const previous = snapResult.recordset[1] || null;

        // Top 5 remediaciones del snapshot actual
        const remResult = await pool.request()
            .input('sid', sql.Int, current.id)
            .query(`
                SELECT TOP 5 remediation, description, vulnerabilities
                FROM remediations
                WHERE snapshot_id = @sid
                ORDER BY vulnerabilities DESC
            `);

        // Top 5 equipos del snapshot actual
        const eqResult = await pool.request()
            .input('sid', sql.Int, current.id)
            .query(`
                SELECT TOP 5 name, vulnerabilities
                FROM equipment
                WHERE snapshot_id = @sid
                ORDER BY vulnerabilities DESC
            `);

        // Top 5 remediaciones del snapshot anterior (para comparar)
        let prevRemediations = [];
        let prevEquipment = [];
        if (previous) {
            const pr = await pool.request()
                .input('sid', sql.Int, previous.id)
                .query(`
                    SELECT TOP 5 remediation, vulnerabilities
                    FROM remediations
                    WHERE snapshot_id = @sid
                    ORDER BY vulnerabilities DESC
                `);
            const pe = await pool.request()
                .input('sid', sql.Int, previous.id)
                .query(`
                    SELECT TOP 5 name, vulnerabilities
                    FROM equipment
                    WHERE snapshot_id = @sid
                    ORDER BY vulnerabilities DESC
                `);
            prevRemediations = pr.recordset;
            prevEquipment = pe.recordset;
        }

        res.json({
            current: {
                ...current,
                top5Remediations: remResult.recordset,
                top5Equipment: eqResult.recordset
            },
            previous: previous ? {
                ...previous,
                top5Remediations: prevRemediations,
                top5Equipment: prevEquipment
            } : null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

// ── GET /api/snapshots/:id/all ── todas las filas para el modal "Ver todo"
app.get('/api/snapshots/:id/all', async (req, res) => {
    try {
        const pool = await getPool();
        const sid = parseInt(req.params.id);

        const remResult = await pool.request()
            .input('sid', sql.Int, sid)
            .query(`
                SELECT remediation, description, vulnerabilities
                FROM remediations
                WHERE snapshot_id = @sid
                ORDER BY vulnerabilities DESC
            `);

        const eqResult = await pool.request()
            .input('sid', sql.Int, sid)
            .query(`
                SELECT name, vulnerabilities
                FROM equipment
                WHERE snapshot_id = @sid
                ORDER BY vulnerabilities DESC
            `);

        res.json({
            remediations: remResult.recordset,
            equipment: eqResult.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener datos completos' });
    }
});

// ── POST /api/snapshots ── guardar nuevo snapshot con todos sus datos
app.post('/api/snapshots', async (req, res) => {
    const { date, remediations, equipment } = req.body;

    if (!date || !remediations || !Array.isArray(remediations)) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();
        const request = new sql.Request(transaction);

        // Verificar si ya existe snapshot para esa fecha
        const existing = await request
            .input('date', sql.Date, date)
            .query('SELECT id FROM snapshots WHERE snapshot_date = @date');

        if (existing.recordset.length > 0) {
            const existingId = existing.recordset[0].id;
            // Borrar datos anteriores del mismo día (CASCADE borra remediations y equipment)
            await new sql.Request(transaction)
                .input('id', sql.Int, existingId)
                .query('DELETE FROM snapshots WHERE id = @id');
        }

        const totalVulns = remediations.reduce((s, r) => s + (r.vulnerabilities || 0), 0);

        // Insertar snapshot
        const snapInsert = await new sql.Request(transaction)
            .input('date', sql.Date, date)
            .input('totalVulns', sql.Int, totalVulns)
            .input('totalRem', sql.Int, remediations.length)
            .input('totalEq', sql.Int, (equipment || []).length)
            .query(`
                INSERT INTO snapshots (snapshot_date, total_vulnerabilities, total_remediations, total_equipment)
                OUTPUT INSERTED.id
                VALUES (@date, @totalVulns, @totalRem, @totalEq)
            `);

        const snapshotId = snapInsert.recordset[0].id;

        // Insertar remediaciones en bulk
        for (const rem of remediations) {
            await new sql.Request(transaction)
                .input('sid', sql.Int, snapshotId)
                .input('rem', sql.NVarChar(500), rem.remediation || '')
                .input('desc', sql.NVarChar(sql.MAX), rem.description || '')
                .input('vulns', sql.Int, rem.vulnerabilities || 0)
                .query(`
                    INSERT INTO remediations (snapshot_id, remediation, description, vulnerabilities)
                    VALUES (@sid, @rem, @desc, @vulns)
                `);
        }

        // Insertar equipos en bulk
        for (const eq of (equipment || [])) {
            await new sql.Request(transaction)
                .input('sid', sql.Int, snapshotId)
                .input('name', sql.NVarChar(255), eq.name || '')
                .input('vulns', sql.Int, eq.vulnerabilities || 0)
                .query(`
                    INSERT INTO equipment (snapshot_id, name, vulnerabilities)
                    VALUES (@sid, @name, @vulns)
                `);
        }

        await transaction.commit();
        res.json({ success: true, snapshotId });
    } catch (err) {
        await transaction.rollback();
        console.error(err);
        res.status(500).json({ error: 'Error al guardar datos' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
