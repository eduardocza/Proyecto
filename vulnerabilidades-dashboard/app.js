let tracker;

class VulnerabilityTracker {
    constructor() {
        this.remediationsData = null;
        this.equipmentData = null;
        this.history = this.loadHistory();
        this.init();
    }

    init() {
        this.currentSlide = 0;
        this.charts = {};

        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('es-ES', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        document.getElementById('remediationsFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'remediations');
        });

        document.getElementById('equipmentFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'equipment');
        });

        document.getElementById('processBtn').addEventListener('click', () => {
            this.processData();
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportHistory();
        });

        this.displayHistory();
        this.initCharts();
    }

    handleFileUpload(event, type) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const csv = e.target.result;
            const data = this.parseCSV(csv);
            
            if (type === 'remediations') {
                this.remediationsData = data;
            } else {
                this.equipmentData = data;
            }
        };
        reader.readAsText(file);
    }

    parseCSV(csv) {
        const lines = csv.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        
        return lines.slice(1).map(line => {
            const values = this.parseCSVLine(line);
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = values[index] ? values[index].trim() : '';
            });
            return obj;
        });
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        
        return result;
    }

    processData() {
        if (!this.remediationsData) {
            alert('Por favor, carga el archivo de remediaciones');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        
        const processedData = this.remediationsData.map(item => {
            const vulnCount = parseInt(item.Vulnerabilities || item.vulnerabilities || 0);
            return {
                remediation: item.Remediation || item.remediation || '',
                description: item.Description || item.description || '',
                vulnerabilities: vulnCount
            };
        }).filter(item => item.remediation && !isNaN(item.vulnerabilities));

        const sortedRemediations = processedData.sort((a, b) => b.vulnerabilities - a.vulnerabilities);
        const top5 = sortedRemediations.slice(0, 5);

        const totalVulns = processedData.reduce((sum, item) => sum + item.vulnerabilities, 0);

        // Process equipment data
        let equipmentProcessed = [];
        if (this.equipmentData && this.equipmentData.length > 0) {
            const sample = this.equipmentData[0];
            const vulnKey = Object.keys(sample).find(k => /vuln/i.test(k)) || Object.keys(sample)[1];
            const nameKey = Object.keys(sample).find(k => /equip|host|name|device|machine/i.test(k)) || Object.keys(sample)[0];

            equipmentProcessed = this.equipmentData.map(item => ({
                name: item[nameKey] || '',
                vulnerabilities: parseInt(item[vulnKey] || 0)
            })).filter(e => e.name && !isNaN(e.vulnerabilities))
              .sort((a, b) => b.vulnerabilities - a.vulnerabilities);
        }

        const top5Equipment = equipmentProcessed.slice(0, 5);
        const totalEquipment = equipmentProcessed.length;

        const snapshot = {
            date: today,
            timestamp: Date.now(),
            totalVulnerabilities: totalVulns,
            totalRemediations: processedData.length,
            totalEquipment: totalEquipment,
            top5: top5,
            allRemediations: sortedRemediations,
            top5Equipment: top5Equipment,
            allEquipment: equipmentProcessed
        };

        this.history.unshift(snapshot);
        if (this.history.length > 30) {
            this.history = this.history.slice(0, 30);
        }
        
        this.saveHistory();
        this.displayData(snapshot);
        this.displayHistory();
        this.updateCharts();
    }

    displayData(snapshot) {
        const previousSnapshot = this.history[1];

        document.getElementById('totalVulns').textContent = snapshot.totalVulnerabilities;
        document.getElementById('totalRemediations').textContent = snapshot.totalRemediations;
        document.getElementById('totalEquipment').textContent = snapshot.totalEquipment;

        if (previousSnapshot) {
            const change = snapshot.totalVulnerabilities - previousSnapshot.totalVulnerabilities;
            const changeEl = document.getElementById('totalChange');
            if (change > 0) {
                changeEl.textContent = `+${change} desde ayer`;
                changeEl.className = 'stat-change positive';
            } else if (change < 0) {
                changeEl.textContent = `${change} desde ayer`;
                changeEl.className = 'stat-change negative';
            } else {
                changeEl.textContent = 'Sin cambios';
                changeEl.className = 'stat-change';
            }
        }

        // Remediations table
        this.fillRemediationsTable('tableBody', snapshot.top5, previousSnapshot ? previousSnapshot.top5 : null);

        // Equipment table
        this.fillEquipmentTable('equipmentTableBody', snapshot.top5Equipment || [], previousSnapshot ? (previousSnapshot.top5Equipment || []) : []);
    }

    fillRemediationsTable(tbodyId, items, prevItems) {
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '';

        if (!items || items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="no-data">Sin datos</td></tr>`;
            return;
        }

        items.forEach((item, index) => {
            const row = tbody.insertRow();
            row.insertCell(0).textContent = index + 1;
            row.insertCell(1).textContent = item.remediation;
            row.insertCell(2).textContent = item.description;
            row.insertCell(3).textContent = item.vulnerabilities;

            const changeCell = row.insertCell(4);
            const prevItem = prevItems && prevItems[index];
            if (prevItem) {
                const diff = item.vulnerabilities - prevItem.vulnerabilities;
                if (diff > 0) changeCell.innerHTML = `<span class="change-indicator change-up">+${diff}</span>`;
                else if (diff < 0) changeCell.innerHTML = `<span class="change-indicator change-down">${diff}</span>`;
                else changeCell.innerHTML = `<span class="change-indicator change-same">0</span>`;
            } else {
                changeCell.innerHTML = `<span class="change-indicator change-same">Nuevo</span>`;
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

        items.forEach((item, index) => {
            const row = tbody.insertRow();
            row.insertCell(0).textContent = index + 1;
            row.insertCell(1).textContent = item.name;
            row.insertCell(2).textContent = item.vulnerabilities;

            const changeCell = row.insertCell(3);
            const prevItem = prevItems && prevItems[index];
            if (prevItem) {
                const diff = item.vulnerabilities - prevItem.vulnerabilities;
                if (diff > 0) changeCell.innerHTML = `<span class="change-indicator change-up">+${diff}</span>`;
                else if (diff < 0) changeCell.innerHTML = `<span class="change-indicator change-down">${diff}</span>`;
                else changeCell.innerHTML = `<span class="change-indicator change-same">0</span>`;
            } else {
                changeCell.innerHTML = `<span class="change-indicator change-same">Nuevo</span>`;
            }
        });
    }

    openModal(type) {
        const snapshot = this.history[0];
        if (!snapshot) return;

        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const thead = document.getElementById('modalThead');
        const tbody = document.getElementById('modalTbody');
        const prevSnapshot = this.history[1];

        if (type === 'remediations') {
            title.textContent = 'Todas las Remediaciones';
            thead.innerHTML = `<tr><th>#</th><th>Remediación</th><th>Descripción</th><th>Vulnerabilidades</th><th>Cambio</th></tr>`;
            tbody.id = 'modalTbody';
            this.fillRemediationsTable('modalTbody', snapshot.allRemediations || snapshot.top5, prevSnapshot ? (prevSnapshot.allRemediations || prevSnapshot.top5) : null);
        } else {
            title.textContent = 'Todos los Equipos';
            thead.innerHTML = `<tr><th>#</th><th>Equipo</th><th>Vulnerabilidades</th><th>Cambio</th></tr>`;
            tbody.id = 'modalTbody';
            this.fillEquipmentTable('modalTbody', snapshot.allEquipment || snapshot.top5Equipment || [], prevSnapshot ? (prevSnapshot.allEquipment || prevSnapshot.top5Equipment || []) : []);
        }

        modal.classList.add('active');
    }

    closeModal(event) {
        if (!event || event.target === document.getElementById('modal') || event.currentTarget === document.querySelector('.modal-close')) {
            document.getElementById('modal').classList.remove('active');
        }
    }

    initCharts() {
        const commonOptions = () => ({
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
            data: { labels: [], datasets: [{ label: 'Total', data: [], borderColor: '#667eea', backgroundColor: 'rgba(102,126,234,0.15)', fill: true, tension: 0.3 }] },
            options: commonOptions()
        });

        this.charts.resolved = new Chart(document.getElementById('chartResolved'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Resueltas', data: [], backgroundColor: 'rgba(72,187,120,0.7)', borderColor: '#48bb78', borderWidth: 2 }] },
            options: commonOptions()
        });

        this.charts.newVulns = new Chart(document.getElementById('chartNew'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Nuevas', data: [], backgroundColor: 'rgba(229,62,62,0.7)', borderColor: '#e53e3e', borderWidth: 2 }] },
            options: commonOptions()
        });

        this.updateCharts();
    }

    updateCharts() {
        if (!this.charts || !this.charts.total) return;

        const sorted = [...this.history].reverse().slice(-15);
        const labels = sorted.map(s => s.date.slice(5));
        const totals = sorted.map(s => s.totalVulnerabilities);

        const resolved = sorted.map((s, i) => {
            if (i === 0) return 0;
            const diff = sorted[i - 1].totalVulnerabilities - s.totalVulnerabilities;
            return diff > 0 ? diff : 0;
        });

        const newVulns = sorted.map((s, i) => {
            if (i === 0) return 0;
            const diff = s.totalVulnerabilities - sorted[i - 1].totalVulnerabilities;
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

    displayHistory() {
        const historyList = document.getElementById('historyList');
        
        if (this.history.length === 0) {
            historyList.innerHTML = '<p class="no-data">No hay datos históricos</p>';
            return;
        }

        historyList.innerHTML = this.history.slice(0, 10).map(snapshot => `
            <div class="history-item">
                <h4>${new Date(snapshot.date).toLocaleDateString('es-ES')}</h4>
                <p>Total: ${snapshot.totalVulnerabilities} vulnerabilidades | ${snapshot.totalRemediations} remediaciones | ${snapshot.totalEquipment} equipos</p>
            </div>
        `).join('');
    }

    loadHistory() {
        const stored = localStorage.getItem('vulnerabilityHistory');
        return stored ? JSON.parse(stored) : [];
    }

    saveHistory() {
        localStorage.setItem('vulnerabilityHistory', JSON.stringify(this.history));
    }

    exportHistory() {
        if (this.history.length === 0) {
            alert('No hay datos para exportar');
            return;
        }

        const csv = this.generateHistoryCSV();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `historico_vulnerabilidades_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    generateHistoryCSV() {
        let csv = 'Fecha,Total Vulnerabilidades,Total Remediaciones,Total Equipos\n';
        
        this.history.forEach(snapshot => {
            csv += `${snapshot.date},${snapshot.totalVulnerabilities},${snapshot.totalRemediations},${snapshot.totalEquipment}\n`;
        });
        
        return csv;
    }
}

tracker = new VulnerabilityTracker();
