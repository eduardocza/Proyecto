const API = '';  // mismo origen, App Service sirve frontend y backend

let tracker;

class VulnerabilityTracker {
    constructor() {
        this.remediationsData = null;
        this.equipmentData = null;
        this.currentSlide = 0;
        this.charts = {};
        this.currentSnapshotId = null;
        this.init();
    }

    async init() {
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('es-ES', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        document.getElementById('remediationsFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'remediations');
        });
        document.getElementById('equipmentFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'equipment');
        });
        document.getElementById('processBtn').addEventListener('click', () => this.processData());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportHistory());

        this.initCharts();
        await this.loadLatest();
        await this.loadHistory();
    }

    // ── File parsing ──────────────────────────────────────────────

    handleFileUpload(event, type) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = this.parseCSV(e.target.result);
            if (type === 'remediations') this.remediationsData = data;
            else this.equipmentData = data;
        };
        reader.readAsText(file);
    }

    parseCSV(csv) {
        const lines = csv.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        return lines.slice(1).map(line => {
            const values = this.parseCSVLine(line);
            const obj = {};
            headers.forEach((h, i) => { obj[h] = values[i] ? values[i].trim() : ''; });
            return obj;
        });
    }

    parseCSVLine(line) {
        const result = [];
        let current = '', inQuotes = false;
        for (const char of line) {
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
            else current += char;
        }
        result.push(current);
        return result;
    }

    // ── Process & save ────────────────────────────────────────────

    async processData() {
        if (!this.remediationsData) {
            alert('Por favor, carga el archivo de remediaciones');
            return;
        }

        const remediations = this.remediationsData.map(item => ({
            remediation: item.Remediation || item.remediation || '',
            description: item.Description || item.description || '',
            vulnerabilities: parseInt(item.Vulnerabilities || item.vulnerabilities || 0)
        })).filter(r => r.remediation && !isNaN(r.vulnerabilities));

        let equipment = [];
        if (this.equipmentData && this.equipmentData.length > 0) {
            const sample = this.equipmentData[0];
            const vulnKey = Object.keys(sample).find(k => /vuln/i.test(k)) || Object.keys(sample)[1];
            const nameKey = Object.keys(sample).find(k => /equip|host|name|device|machine/i.test(k)) || Object.keys(sample)[0];
            equipment = this.equipmentData.map(item => ({
                name: item[nameKey] || '',
                vulnerabilities: parseInt(item[vulnKey] || 0)
            })).filter(e => e.name && !isNaN(e.vulnerabilities));
        }

        const today = new Date().toISOString().split('T')[0];

        try {
            document.getElementById('processBtn').textContent = 'Guardando...';
            document.getElementById('processBtn').disabled = true;

            const res = await fetch(`${API}/api/snapshots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: today, remediations, equipment })
            });

            if (!res.ok) throw new Error('Error al guardar');

            await this.loadLatest();
            await this.loadHistory();
        } catch (err) {
            alert('Error al guardar los datos: ' + err.message);
        } finally {
            document.getElementById('processBtn').textContent = 'Procesar Datos';
            document.getElementById('processBtn').disabled = false;
        }
    }

    // ── Load from API ─────────────────────────────────────────────

    async loadLatest() {
        try {
            const res = await fetch(`${API}/api/snapshots/latest`);
            const data = await res.json();
            if (!data) return;

            this.currentSnapshotId = data.current.id;
            this.displayData(data.current, data.previous);
        } catch (err) {
            console.error('Error cargando datos:', err);
        }
    }

    async loadHistory() {
        try {
            const res = await fetch(`${API}/api/snapshots?limit=15`);
            const snapshots = await res.json();
            this.displayHistory(snapshots);
            this.updateCharts(snapshots);
        } catch (err) {
            console.error('Error cargando histórico:', err);
        }
    }

    // ── Display ───────────────────────────────────────────────────

    displayData(current, previous) {
        document.getElementById('totalVulns').textContent = current.total_vulnerabilities;
        document.getElementById('totalRemediations').textContent = current.total_remediations;
        document.getElementById('totalEquipment').textContent = current.total_equipment;

        if (previous) {
            const change = current.total_vulnerabilities - previous.total_vulnerabilities;
            const el = document.getElementById('totalChange');
            if (change > 0) { el.textContent = `+${change} desde ayer`; el.className = 'stat-change positive'; }
            else if (change < 0) { el.textContent = `${change} desde ayer`; el.className = 'stat-change negative'; }
            else { el.textContent = 'Sin cambios'; el.className = 'stat-change'; }
        }

        this.fillRemediationsTable('tableBody', current.top5Remediations, previous ? previous.top5Remediations : null);
        this.fillEquipmentTable('equipmentTableBody', current.top5Equipment, previous ? previous.top5Equipment : null);
    }

    fillRemediationsTable(tbodyId, items, prevItems) {
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '';
        if (!items || items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="no-data">Sin datos</td></tr>`;
            return;
        }
        items.forEach((item, i) => {
            const row = tbody.insertRow();
            row.insertCell(0).textContent = i + 1;
            row.insertCell(1).textContent = item.remediation;
            row.insertCell(2).textContent = item.description;
            row.insertCell(3).textContent = item.vulnerabilities;
            const cc = row.insertCell(4);
            const prev = prevItems && prevItems[i];
            if (prev) {
                const diff = item.vulnerabilities - prev.vulnerabilities;
                if (diff > 0) cc.innerHTML = `<span class="change-indicator change-up">+${diff}</span>`;
                else if (diff < 0) cc.innerHTML = `<span class="change-indicator change-down">${diff}</span>`;
                else cc.innerHTML = `<span class="change-indicator change-same">0</span>`;
            } else {
                cc.innerHTML = `<span class="change-indicator change-same">Nuevo</span>`;
            }
        });
    }

    fillEquipmentTable(tbodyId, items, prevItems) {
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '';
        if (!items || items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="no-data">Carga el archivo de equipos para ver los datos</td></tr>`;
            return;
        }
        items.forEach((item, i) => {
            const row = tbody.insertRow();
            row.insertCell(0).textContent = i + 1;
            row.insertCell(1).textContent = item.name;
            row.insertCell(2).textContent = item.vulnerabilities;
            const cc = row.insertCell(3);
            const prev = prevItems && prevItems[i];
            if (prev) {
                const diff = item.vulnerabilities - prev.vulnerabilities;
                if (diff > 0) cc.innerHTML = `<span class="change-indicator change-up">+${diff}</span>`;
                else if (diff < 0) cc.innerHTML = `<span class="change-indicator change-down">${diff}</span>`;
                else cc.innerHTML = `<span class="change-indicator change-same">0</span>`;
            } else {
                cc.innerHTML = `<span class="change-indicator change-same">Nuevo</span>`;
            }
        });
    }

    displayHistory(snapshots) {
        const el = document.getElementById('historyList');
        if (!snapshots || snapshots.length === 0) {
            el.innerHTML = '<p class="no-data">No hay datos históricos</p>';
            return;
        }
        el.innerHTML = snapshots.map(s => `
            <div class="history-item">
                <h4>${new Date(s.snapshot_date).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</h4>
                <p>Total: ${s.total_vulnerabilities} vulnerabilidades | ${s.total_remediations} remediaciones | ${s.total_equipment} equipos</p>
            </div>
        `).join('');
    }

    // ── Modal "Ver todo" ──────────────────────────────────────────

    async openModal(type) {
        if (!this.currentSnapshotId) return;

        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const thead = document.getElementById('modalThead');
        const tbody = document.getElementById('modalTbody');

        tbody.innerHTML = `<tr><td colspan="5" class="no-data">Cargando...</td></tr>`;
        modal.classList.add('active');

        try {
            const res = await fetch(`${API}/api/snapshots/${this.currentSnapshotId}/all`);
            const data = await res.json();

            if (type === 'remediations') {
                title.textContent = 'Todas las Remediaciones';
                thead.innerHTML = `<tr><th>#</th><th>Remediación</th><th>Descripción</th><th>Vulnerabilidades</th></tr>`;
                tbody.innerHTML = '';
                data.remediations.forEach((item, i) => {
                    const row = tbody.insertRow();
                    row.insertCell(0).textContent = i + 1;
                    row.insertCell(1).textContent = item.remediation;
                    row.insertCell(2).textContent = item.description;
                    row.insertCell(3).textContent = item.vulnerabilities;
                });
            } else {
                title.textContent = 'Todos los Equipos';
                thead.innerHTML = `<tr><th>#</th><th>Equipo</th><th>Vulnerabilidades</th></tr>`;
                tbody.innerHTML = '';
                data.equipment.forEach((item, i) => {
                    const row = tbody.insertRow();
                    row.insertCell(0).textContent = i + 1;
                    row.insertCell(1).textContent = item.name;
                    row.insertCell(2).textContent = item.vulnerabilities;
                });
            }
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="no-data">Error al cargar datos</td></tr>`;
        }
    }

    closeModal(event) {
        if (!event || event.target === document.getElementById('modal')) {
            document.getElementById('modal').classList.remove('active');
        }
    }

    // ── Charts ────────────────────────────────────────────────────

    initCharts() {
        const opts = () => ({
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxRotation: 45 } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        });

        this.charts.total = new Chart(document.getElementById('chartTotal'), {
            type: 'line',
            data: { labels: [], datasets: [{ data: [], borderColor: '#667eea', backgroundColor: 'rgba(102,126,234,0.15)', fill: true, tension: 0.3 }] },
            options: opts()
        });
        this.charts.resolved = new Chart(document.getElementById('chartResolved'), {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(72,187,120,0.7)', borderColor: '#48bb78', borderWidth: 2 }] },
            options: opts()
        });
        this.charts.newVulns = new Chart(document.getElementById('chartNew'), {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(229,62,62,0.7)', borderColor: '#e53e3e', borderWidth: 2 }] },
            options: opts()
        });
    }

    updateCharts(snapshots) {
        if (!snapshots || snapshots.length === 0) return;
        const sorted = [...snapshots].reverse();
        const labels = sorted.map(s => s.snapshot_date.slice(5));
        const totals = sorted.map(s => s.total_vulnerabilities);
        const resolved = sorted.map((s, i) => {
            if (i === 0) return 0;
            const diff = sorted[i - 1].total_vulnerabilities - s.total_vulnerabilities;
            return diff > 0 ? diff : 0;
        });
        const newVulns = sorted.map((s, i) => {
            if (i === 0) return 0;
            const diff = s.total_vulnerabilities - sorted[i - 1].total_vulnerabilities;
            return diff > 0 ? diff : 0;
        });

        [this.charts.total, this.charts.resolved, this.charts.newVulns].forEach(c => { c.data.labels = labels; });
        this.charts.total.data.datasets[0].data = totals;
        this.charts.resolved.data.datasets[0].data = resolved;
        this.charts.newVulns.data.datasets[0].data = newVulns;
        Object.values(this.charts).forEach(c => c.update());
    }

    slideChart(dir) {
        this.currentSlide = (this.currentSlide + dir + 3) % 3;
        this.goToSlide(this.currentSlide);
    }

    goToSlide(index) {
        this.currentSlide = index;
        document.getElementById('carouselTrack').style.transform = `translateX(-${index * 100}%)`;
        document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === index));
    }

    // ── Export ────────────────────────────────────────────────────

    async exportHistory() {
        try {
            const res = await fetch(`${API}/api/snapshots?limit=30`);
            const snapshots = await res.json();
            if (!snapshots.length) { alert('No hay datos para exportar'); return; }

            let csv = 'Fecha,Total Vulnerabilidades,Total Remediaciones,Total Equipos\n';
            snapshots.forEach(s => {
                csv += `${s.snapshot_date},${s.total_vulnerabilities},${s.total_remediations},${s.total_equipment}\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `historico_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
        } catch (err) {
            alert('Error al exportar: ' + err.message);
        }
    }
}

tracker = new VulnerabilityTracker();
