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
        // Selector de fecha por defecto = hoy
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('dataDate').value = todayStr;
        document.getElementById('manualDate').value = todayStr;

        // Rango de reporte: lunes a viernes de la semana actual
        const today = new Date();
        const day = today.getDay();
        const monday = new Date(today); monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
        const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
        document.getElementById('reportFrom').value = monday.toISOString().split('T')[0];
        document.getElementById('reportTo').value = friday.toISOString().split('T')[0];

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
        document.getElementById('reportBtn').addEventListener('click', () => this.generatePDF());
        document.getElementById('manualBtn').addEventListener('click', () => this.saveManual());

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

        const today = document.getElementById('dataDate').value || new Date().toISOString().split('T')[0];

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
            const res = await fetch(`${API}/api/history?limit=30`);
            const snapshots = await res.json();
            this.displayHistory(snapshots);
            this.updateCharts(snapshots);
        } catch (err) {
            console.error('Error cargando histórico:', err);
        }
    }

    // ── Manual entry ──────────────────────────────────────────────

    async saveManual() {
        const date = document.getElementById('manualDate').value;
        const total = document.getElementById('manualVulns').value;

        if (!date || total === '') { alert('Completa la fecha y el total de vulnerabilidades'); return; }

        const btn = document.getElementById('manualBtn');
        btn.textContent = 'Guardando...';
        btn.disabled = true;

        try {
            const res = await fetch(`${API}/api/manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, total_vulnerabilities: parseInt(total) })
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al guardar'); return; }
            alert(`Registro del ${date} guardado correctamente`);
            document.getElementById('manualVulns').value = '';
            await this.loadHistory();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btn.textContent = 'Guardar Registro';
            btn.disabled = false;
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
            tbody.innerHTML = `<tr><td colspan="5" class="no-data">Carga el archivo de equipos para ver los datos</td></tr>`;
            return;
        }

        const statuses = ['Sin asignar', 'Correo enviado', 'Horario confirmado', 'En atención', 'Completado', 'Pospuesto'];
        const statusColors = {
            'Sin asignar': 'status-none',
            'Correo enviado': 'status-email',
            'Horario confirmado': 'status-scheduled',
            'En atención': 'status-active',
            'Completado': 'status-done',
            'Pospuesto': 'status-postponed'
        };

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

            // Columna de estado de soporte
            const statusCell = row.insertCell(4);
            if (item.id) {
                const currentStatus = item.support_status || 'Sin asignar';
                const select = document.createElement('select');
                select.className = `status-select ${statusColors[currentStatus] || 'status-none'}`;
                statuses.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s;
                    opt.textContent = s;
                    if (s === currentStatus) opt.selected = true;
                    select.appendChild(opt);
                });
                select.addEventListener('change', async (e) => {
                    const newStatus = e.target.value;
                    select.className = `status-select ${statusColors[newStatus] || 'status-none'}`;
                    await fetch(`${API}/api/equipment/${item.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                    });
                });
                statusCell.appendChild(select);
            } else {
                statusCell.textContent = '-';
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
        const sorted = [...snapshots];
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

    // ── PDF Report ────────────────────────────────────────────────

    async generatePDF() {
        const from = document.getElementById('reportFrom').value;
        const to = document.getElementById('reportTo').value;
        if (!from || !to) { alert('Selecciona el rango de fechas'); return; }

        const btn = document.getElementById('reportBtn');
        btn.textContent = 'Generando...';
        btn.disabled = true;

        try {
            const res = await fetch(`${API}/api/weekly-report?from=${from}&to=${to}`);
            const data = await res.json();

            if (!data.first) { alert('No hay datos para ese rango de fechas'); return; }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = 210, margin = 14;
            let y = 0;

            const fmtDate = d => new Date(d).toLocaleDateString('es-ES', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
            const colW = (W - margin * 2) / 4;

            const addPage = () => { doc.addPage(); y = 15; };
            const checkY = (needed = 10) => { if (y + needed > 280) addPage(); };

            // ── Encabezado ──
            doc.setFillColor(102, 126, 234);
            doc.rect(0, 0, W, 28, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(16); doc.setFont('helvetica', 'bold');
            doc.text('Reporte Semanal de Vulnerabilidades', W / 2, 11, { align: 'center' });
            doc.setFontSize(10); doc.setFont('helvetica', 'normal');
            doc.text(`Semana: ${fmtDate(from)} — ${fmtDate(to)}`, W / 2, 20, { align: 'center' });
            y = 35;

            // ── Gráficas ──
            doc.setTextColor(50, 50, 50);
            doc.setFontSize(12); doc.setFont('helvetica', 'bold');
            doc.text('Comportamiento de Vulnerabilidades', margin, y); y += 6;

            const chartIds = ['chartTotal', 'chartResolved', 'chartNew'];
            const chartTitles = ['Total', 'Resueltas', 'Nuevas'];
            const chartW = (W - margin * 2 - 8) / 3;

            for (let i = 0; i < chartIds.length; i++) {
                const canvas = document.getElementById(chartIds[i]);
                const imgData = canvas.toDataURL('image/png');
                doc.setFontSize(8); doc.setFont('helvetica', 'normal');
                doc.text(chartTitles[i], margin + i * (chartW + 4) + chartW / 2, y + 3, { align: 'center' });
                doc.addImage(imgData, 'PNG', margin + i * (chartW + 4), y + 5, chartW, 35);
            }
            y += 48;

            // ── Resumen numérico ──
            checkY(20);
            const startVulns = data.first.total_vulnerabilities;
            const endVulns = data.last.total_vulnerabilities;
            const diff = endVulns - startVulns;

            doc.setFillColor(245, 247, 255);
            doc.roundedRect(margin, y, W - margin * 2, 18, 3, 3, 'F');
            doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(50, 50, 50);
            doc.text(`Inicio: ${startVulns}`, margin + 10, y + 7);
            doc.text(`Fin: ${endVulns}`, margin + 55, y + 7);
            const diffText = diff > 0 ? `+${diff} nuevas` : diff < 0 ? `${Math.abs(diff)} resueltas` : 'Sin cambio';
            doc.setTextColor(diff > 0 ? 180 : diff < 0 ? 34 : 80, diff > 0 ? 50 : diff < 0 ? 120 : 80, diff > 0 ? 50 : diff < 0 ? 34 : 80);
            doc.text(`Variación: ${diffText}`, margin + 100, y + 7);
            doc.setTextColor(50, 50, 50);
            doc.text(`Equipos completados: ${data.completedEquipment.length}`, margin + 10, y + 14);
            y += 26;

            // ── Helper tabla ──
            const drawTable = (headers, rows, colWidths) => {
                checkY(10);
                doc.setFillColor(102, 126, 234);
                doc.rect(margin, y, W - margin * 2, 7, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(8); doc.setFont('helvetica', 'bold');
                let x = margin + 2;
                headers.forEach((h, i) => { doc.text(h, x, y + 5); x += colWidths[i]; });
                y += 7;

                rows.forEach((row, ri) => {
                    checkY(7);
                    doc.setFillColor(ri % 2 === 0 ? 255 : 248, ri % 2 === 0 ? 255 : 249, ri % 2 === 0 ? 255 : 255);
                    doc.rect(margin, y, W - margin * 2, 7, 'F');
                    doc.setTextColor(50, 50, 50); doc.setFont('helvetica', 'normal');
                    x = margin + 2;
                    row.forEach((cell, i) => {
                        const txt = String(cell ?? '-');
                        const maxChars = Math.floor(colWidths[i] / 1.8);
                        doc.text(txt.length > maxChars ? txt.slice(0, maxChars) + '…' : txt, x, y + 5);
                        x += colWidths[i];
                    });
                    y += 7;
                });
                y += 4;
            };

            // ── Top 5 inicio vs fin ──
            checkY(30);
            doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(50, 50, 50);
            doc.text('Top 5 Remediaciones — Inicio vs Fin de Semana', margin, y); y += 6;

            const remHeaders = ['#', 'Remediación', 'Inicio', 'Fin', 'Δ'];
            const remColW = [8, 100, 20, 20, 16];
            const remRows = data.first.top5.map((r, i) => {
                const endR = data.last.top5.find(x => x.remediation === r.remediation);
                const endV = endR ? endR.vulnerabilities : '-';
                const delta = endR ? endR.vulnerabilities - r.vulnerabilities : '-';
                return [i + 1, r.remediation, r.vulnerabilities, endV, delta !== '-' ? (delta > 0 ? `+${delta}` : delta) : '-'];
            });
            drawTable(remHeaders, remRows, remColW);

            // ── Movimiento diario ──
            checkY(20);
            doc.setFontSize(12); doc.setFont('helvetica', 'bold');
            doc.text('Movimiento Diario de las 5 Remediaciones Iniciales', margin, y); y += 6;

            const shortNames = data.first.top5.map(r => r.remediation.slice(0, 18));
            const movHeaders = ['Fecha', ...shortNames];
            const movColW = [22, ...shortNames.map(() => (W - margin * 2 - 22) / shortNames.length)];
            const movRows = data.dailyMovement.map(d => [
                fmtDate(d.date),
                ...d.remediations.map(r => r.vulnerabilities ?? '-')
            ]);
            drawTable(movHeaders, movRows, movColW);

            // ── Equipos completados ──
            checkY(20);
            doc.setFontSize(12); doc.setFont('helvetica', 'bold');
            doc.text('Equipos con Soporte Completado', margin, y); y += 6;

            if (data.completedEquipment.length === 0) {
                doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150);
                doc.text('No se completó soporte en ningún equipo durante esta semana.', margin, y); y += 8;
            } else {
                drawTable(['#', 'Equipo', 'Vulnerabilidades'], data.completedEquipment.map((e, i) => [i + 1, e.name, e.vulnerabilities]), [10, 130, 42]);
            }

            // ── Pie de página ──
            const pageCount = doc.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8); doc.setTextColor(150, 150, 150);
                doc.text(`Generado el ${new Date().toLocaleDateString('es-ES')} — Página ${i} de ${pageCount}`, W / 2, 292, { align: 'center' });
            }

            doc.save(`reporte_semana_${from}_${to}.pdf`);
        } catch (err) {
            alert('Error al generar PDF: ' + err.message);
        } finally {
            btn.textContent = 'Generar PDF';
            btn.disabled = false;
        }
    }
}

tracker = new VulnerabilityTracker();
