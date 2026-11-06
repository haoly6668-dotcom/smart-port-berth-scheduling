let pieChartInstance = null, lineChartInstance = null;
let berthChartInstance = null;
let tideInterval = null;   // 潮汐计时器

// 全局数据缓存
window.currentShips = [];
window.currentBerths = [];

function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-check-circle'}"></i> ${msg}`;
    toast.style.color = isError ? '#ffaa88' : '#aaffdd';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function apiFetch(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        showToast(`请求失败: ${err.message}`, true);
        throw err;
    }
}

// 绘制左侧泊位能力对比图
function drawBerthCapabilityChart(berths) {
    const canvas = document.getElementById('berthCapabilityChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (berthChartInstance) { berthChartInstance.destroy(); berthChartInstance = null; }
    if (!berths || berths.length === 0) return;
    const countSpan = document.getElementById('berthCountDisplay');
    if (countSpan) countSpan.textContent = `${berths.length} 个泊位`;
    const labels = berths.map(b => b.id);
    const qcData = berths.map(b => b.totalQC);
    const effData = berths.map(b => b.efficiency);
    berthChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: '岸桥总数', data: qcData, backgroundColor: '#3b82f6', borderRadius: 6 }, { label: '效率 (箱/时)', data: effData, backgroundColor: '#06b6d4', borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { labels: { color: '#E2E8F0', font: { size: 11 } } }, tooltip: { backgroundColor: '#0f2a40', titleColor: '#b0e0ff', bodyColor: '#e2e8f0' } }, scales: { x: { ticks: { color: '#b0cde0' }, grid: { color: '#1e3a5a' } }, y: { ticks: { color: '#b0cde0' }, grid: { color: '#1e3a5a' } } } }
    });
}

// 更新左侧小组件
async function updateLeftWidgets() {
    let shipsData = window.currentShips;
    if (!shipsData || shipsData.length === 0) {
        try { shipsData = await apiFetch('/api/ships'); window.currentShips = shipsData; } catch(e){ shipsData = []; }
    }
    let berthsData = window.currentBerths;
    if (!berthsData || berthsData.length === 0) {
        try { berthsData = await apiFetch('/api/berths'); window.currentBerths = berthsData; } catch(e){ berthsData = []; }
    }
    // 计算指标
    const totalShips = shipsData.length;
    const totalTeu = shipsData.reduce((sum, s) => sum + (s.teu || 0), 0);
    const highPriorityCount = shipsData.filter(s => s.priority === 'high').length;
    const totalQc = berthsData.reduce((sum, b) => sum + (b.totalQC || 0), 0);
    document.getElementById('totalShipsCount').innerText = totalShips;
    document.getElementById('totalTeuSum').innerText = totalTeu.toLocaleString();
    document.getElementById('highPriorityCount').innerText = highPriorityCount;
    document.getElementById('totalQcCount').innerText = totalQc;
    // 计算负荷指数: 基于总TEU与泊位日处理能力(效率*岸桥数*24h)的比值
    let totalDailyCapacity = 0;
    berthsData.forEach(b => {
        let berthDaily = (b.efficiency || 30) * (b.totalQC || 1) * 24;
        totalDailyCapacity += berthDaily;
    });
    let loadPercent = 0;
    if (totalDailyCapacity > 0 && totalTeu > 0) loadPercent = Math.min(100, (totalTeu / totalDailyCapacity) * 100);
    if (totalShips === 0) loadPercent = 0;
    document.getElementById('loadFactor').innerText = Math.floor(loadPercent) + '%';
    document.getElementById('loadFactorBar').style.width = loadPercent + '%';
}

// 潮汐模拟 (动态更新，基于真实时间正弦曲线)
function updateTide() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    // 模拟潮汐周期约12.4小时，振幅1.5米，基准2.8米
    const tideBase = 2.8;
    const amplitude = 1.5;
    const tideValue = tideBase + amplitude * Math.sin((hours / 12.4) * Math.PI * 2);
    const tideFixed = tideValue.toFixed(1);
    let tideStatusText = '';
    if (tideFixed >= 4.0) tideStatusText = '🌊 大潮 · 注意吃水';
    else if (tideFixed <= 2.0) tideStatusText = '⚓ 低潮 · 谨慎靠泊';
    else tideStatusText = '适宜作业';
    document.getElementById('tideHeight').innerText = tideFixed;
    const statusSpan = document.getElementById('tideStatus');
    if (statusSpan) statusSpan.innerHTML = tideStatusText;
}

// 加载泊位数据
async function loadBerths() {
    const berths = await apiFetch('/api/berths');
    window.currentBerths = berths;
    drawBerthCapabilityChart(berths);
    updateLeftWidgets(); 
}

// 加载船舶列表
async function loadShips() {
    const ships = await apiFetch('/api/ships');
    window.currentShips = ships;
    const container = document.getElementById('shipListContainer');
    if (!ships.length) {
        container.innerHTML = `<div style="text-align:center; padding:20px;"><i class="fas fa-water"></i> 暂无船舶数据，请添加</div>`;
    } else {
        container.innerHTML = ships.map(ship => `
            <div class="ship-item" data-id="${ship.id}">
                <div><strong>${ship.name}</strong> ${ship.teu}TEU | 吃水${ship.draft}m | ${ship.arrivalTime}</div>
                <div><span class="badge-priority" style="background:${ship.priority==='high'?'#d43f1a':'#1f5a6e'}">${ship.priority==='high'?'⚡急件':(ship.priority==='mid'?'普通':'🚢支线')}</span>
                <button class="btn-icon delete-ship" data-id="${ship.id}"><i class="fas fa-trash-alt"></i></button></div>
            </div>
        `).join('');
        document.querySelectorAll('.delete-ship').forEach(btn => {
            btn.addEventListener('click', async () => {
                await apiFetch(`/api/ships/${btn.dataset.id}`, { method: 'DELETE' });
                await loadShips();
                updateLeftWidgets();
                showToast('船舶已删除');
            });
        });
    }
    updateLeftWidgets();
}

async function addShip() {
    const name = document.getElementById('shipName').value.trim();
    const len = parseFloat(document.getElementById('shipLen').value);
    const draft = parseFloat(document.getElementById('shipDraft').value);
    const teu = parseInt(document.getElementById('shipTeu').value);
    const arrival = document.getElementById('shipArrival').value;
    const priority = document.getElementById('shipPriority').value;
    if (!name || isNaN(len) || isNaN(draft) || isNaN(teu) || teu <= 0) {
        showToast('请完整填写船舶信息', true);
        return;
    }
    await apiFetch('/api/ships', {
        method: 'POST',
        body: JSON.stringify({ name, length: len, draft, teu, arrivalTime: arrival, priority })
    });
    await loadShips();
    document.getElementById('shipName').value = '';
    document.getElementById('shipLen').value = '';
    document.getElementById('shipDraft').value = '';
    document.getElementById('shipTeu').value = '';
    showToast('船舶已添加');
}

// 调度逻辑 (保持原有)
async function runSchedule() {
    const btn = document.getElementById('runSchedulerBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 调度计算中...';
    btn.disabled = true;
    try {
        const result = await apiFetch('/api/schedule', { method: 'POST' });
        if (result.error) { showToast(result.error, true); return; }
        displayResults(result.assignments, result.berthState);
        showToast('调度完成');
    } catch (err) { showToast('调度失败', true); }
    finally { btn.innerHTML = '运行智能调度'; btn.disabled = false; }
}

function displayResults(assignments, berthState) {
    if (!assignments.length || assignments[0]?.error) {
        document.getElementById('ganttChartArea').innerHTML = `<div style="padding:28px;text-align:center;"><i class="fas fa-exclamation-triangle"></i> 调度失败: 请检查船舶吃水/长度是否匹配泊位约束</div>`;
        document.getElementById('allocationTableWrapper').innerHTML = `<div style="padding:16px; text-align:center;">⚠️ 无有效分配</div>`;
        destroyCharts(); return;
    }
    const totalMinutes = assignments.reduce((s, a) => s + (a.endMin - a.startMin), 0);
    const makespanMin = Math.max(...assignments.map(a => a.endMin), 0);
    const totalSpan = makespanMin - Math.min(...assignments.map(a => a.startMin), 0);
    const utilization = (totalMinutes / (berthState.length * totalSpan)) * 100;
    document.getElementById('totalTimeStat').textContent = (totalMinutes / 60).toFixed(1);
    document.getElementById('makespan').textContent = minutesToTime(makespanMin);
    document.getElementById('utilRate').textContent = utilization.toFixed(1);
    let ganttHtml = `<div style="font-weight:700; margin-bottom:14px;"><i class="fas fa-chart-line"></i> 泊位动态调度时序</div>`;
    berthState.forEach(berth => {
        if (berth.schedule.length === 0) return;
        ganttHtml += `<div class="berth-row"><div style="display:flex; justify-content:space-between;"><strong>📍 ${berth.id}</strong><span>QC:${berth.totalQC}台 | 效率:${berth.efficiency}箱/h</span></div><div class="timeline-bar">`;
        const sorted = [...berth.schedule].sort((a,b) => a.startMin - b.startMin);
        sorted.forEach(s => { const durHours = (s.endMin - s.startMin)/60; const widthPercent = Math.min(100, Math.max(5, durHours * 2.2)); ganttHtml += `<div class="bar-segment" style="width:${widthPercent}%; min-width:85px;" title="${s.shipName} ${s.startTimeStr}~${s.endTimeStr} | ${s.allocatedQC}台岸桥">🚢 ${s.shipName} ${durHours.toFixed(1)}h</div>`; });
        ganttHtml += `</div></div><hr>`;
    });
    document.getElementById('ganttChartArea').innerHTML = ganttHtml || '<div>暂无调度数据</div>';
    let tableHtml = `<table class="result-table"><thead><tr><th>船名</th><th>泊位</th><th>开始</th><th>结束</th><th>岸桥数</th><th>耗时(h)</th></tr></thead><tbody>`;
    assignments.forEach(a => { if (!a.error) { let dur = ((a.endMin - a.startMin)/60).toFixed(1); tableHtml += `<tr><td><strong>${a.shipName}</strong></td><td>${a.berthId}</td><td>${a.startTimeStr}</td><td>${a.endTimeStr}</td><td>${a.allocatedQC}</td><td>${dur}</td>`; } });
    tableHtml += `</tbody></table>`;
    document.getElementById('allocationTableWrapper').innerHTML = tableHtml;
    drawCharts(assignments);
}

function minutesToTime(min) { let h = Math.floor(min / 60) % 24; let m = min % 60; return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`; }
function destroyCharts() { if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; } if (lineChartInstance) { lineChartInstance.destroy(); lineChartInstance = null; } }
function drawCharts(assignments) {
    destroyCharts();
    if (!assignments || assignments.length === 0 || assignments[0]?.error) return;
    let berthWorkMap = new Map();
    assignments.forEach(a => { if(!a.error) berthWorkMap.set(a.berthId, (berthWorkMap.get(a.berthId)||0) + (a.endMin - a.startMin)); });
    const pieLabels = Array.from(berthWorkMap.keys());
    const pieData = Array.from(berthWorkMap.values());
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    pieChartInstance = new Chart(pieCtx, { type: 'pie', data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: ['#3b82f6','#06b6d4','#10b981','#f59e0b','#ef4444'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0' } } } } });
    let sortedAssign = [...assignments].filter(a=>!a.error).sort((x,y)=>x.startMin - y.startMin);
    const waitTimes = sortedAssign.map(a => a.startMin - a.arrivalMin);
    const shipNames = sortedAssign.map(a => a.shipName.length>6 ? a.shipName.slice(0,6)+".." : a.shipName);
    const lineCtx = document.getElementById('lineChart').getContext('2d');
    lineChartInstance = new Chart(lineCtx, { type: 'line', data: { labels: shipNames, datasets: [{ label: '等待时间 (分钟)', data: waitTimes, borderColor: '#00E0FF', backgroundColor: 'rgba(0,224,255,0.1)', fill: true, tension: 0.3, pointBackgroundColor: '#00aaff' }] }, options: { responsive: true, maintainAspectRatio: true } });
}

function drawAnalogClock() {
    const canvas = document.getElementById('analogClock');
    if (!canvas) return; const ctx = canvas.getContext('2d'); const radius = canvas.height / 2; ctx.clearRect(0, 0, canvas.width, canvas.height); const now = new Date(); let hour = now.getHours() % 12, minute = now.getMinutes(), second = now.getSeconds(); hour = (hour * Math.PI / 6) + (minute * Math.PI / 360) + (second * Math.PI / 21600); minute = (minute * Math.PI / 30) + (second * Math.PI / 1800); second = (second * Math.PI / 30); ctx.translate(radius, radius); ctx.beginPath(); ctx.arc(0, 0, radius*0.9, 0, 2*Math.PI); ctx.fillStyle = '#0a1a2a'; ctx.fill(); ctx.strokeStyle = '#00c2ff'; ctx.lineWidth = 3; ctx.stroke(); for (let i=0; i<12; i++) { let angle = i * Math.PI/6; ctx.beginPath(); ctx.moveTo(Math.sin(angle)*(radius*0.7), -Math.cos(angle)*(radius*0.7)); ctx.lineTo(Math.sin(angle)*(radius*0.8), -Math.cos(angle)*(radius*0.8)); ctx.strokeStyle = '#b0e0ff'; ctx.lineWidth = 2; ctx.stroke(); } ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.sin(hour)*(radius*0.5), -Math.cos(hour)*(radius*0.5)); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.sin(minute)*(radius*0.7), -Math.cos(minute)*(radius*0.7)); ctx.strokeStyle = '#aad4ff'; ctx.lineWidth = 3; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.sin(second)*(radius*0.8), -Math.cos(second)*(radius*0.8)); ctx.strokeStyle = '#ff6060'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setTransform(1,0,0,1,0,0);
}
function updateClock() { const now = new Date(); document.getElementById('timeDisplay').textContent = now.toLocaleTimeString('zh-CN', { hour12: false }); drawAnalogClock(); }

// 模态框逻辑 (保持不变)
async function openBerthModal() { const berths = await apiFetch('/api/berths'); const tbody = document.getElementById('modalBerthTbody'); tbody.innerHTML = ''; berths.forEach(b => { const row = tbody.insertRow(); row.insertCell(0).innerHTML = `<input type="text" value="${b.id}" class="modal-id">`; row.insertCell(1).innerHTML = `<input type="number" step="0.1" value="${b.maxDepth}" class="modal-depth">`; row.insertCell(2).innerHTML = `<input type="number" value="${b.totalQC}" class="modal-qc">`; row.insertCell(3).innerHTML = `<input type="number" value="${b.efficiency}" class="modal-eff">`; row.insertCell(4).innerHTML = `<input type="number" value="${b.length}" class="modal-len">`; row.insertCell(5).innerHTML = `<button class="btn-icon" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button>`; }); document.getElementById('berthModal').classList.add('active'); }
async function saveBerthModal() { const rows = document.querySelectorAll('#modalBerthTbody tr'); let newBerths = []; for (let row of rows) { const id = row.querySelector('.modal-id')?.value.trim(); if (!id) { showToast('泊位ID不能为空', true); return; } const depth = parseFloat(row.querySelector('.modal-depth')?.value); const qc = parseInt(row.querySelector('.modal-qc')?.value); const eff = parseInt(row.querySelector('.modal-eff')?.value); const len = parseInt(row.querySelector('.modal-len')?.value); if (isNaN(depth) || isNaN(qc) || isNaN(eff) || isNaN(len)) { showToast('参数必须为数字', true); return; } if (newBerths.some(b=>b.id===id)) { showToast(`泊位ID重复: ${id}`, true); return; } newBerths.push({ id, maxDepth: depth, totalQC: qc, efficiency: eff, length: len }); } if (newBerths.length === 0) { showToast('至少保留一个泊位', true); return; } await apiFetch('/api/berths', { method: 'PUT', body: JSON.stringify(newBerths) }); await loadBerths(); closeBerthModal(); showToast('泊位配置已保存'); document.getElementById('ganttChartArea').innerHTML = `<div style="text-align:center; padding:28px;">泊位已更新，请重新调度</div>`; document.getElementById('allocationTableWrapper').innerHTML = `<div>✨ 配置已保存，点击调度按钮刷新结果</div>`; document.getElementById('totalTimeStat').textContent = '0'; document.getElementById('makespan').textContent = '0'; document.getElementById('utilRate').textContent = '0'; destroyCharts(); }
function closeBerthModal() { document.getElementById('berthModal').classList.remove('active'); }
async function resetBerthsFromModal() { await apiFetch('/api/berths/reset', { method: 'POST' }); await loadBerths(); await openBerthModal(); showToast('已重置为默认泊位配置'); }
function createStars(count = 60) { const starField = document.getElementById('starField'); for (let i = 0; i < count; i++) { const star = document.createElement('div'); star.className = 'star'; const size = Math.random() * 4 + 1; star.style.width = size + 'px'; star.style.height = size + 'px'; star.style.left = Math.random() * 100 + '%'; star.style.top = Math.random() * 100 + '%'; star.style.animationDelay = Math.random() * 4 + 's'; star.style.animationDuration = (Math.random() * 3 + 3) + 's'; starField.appendChild(star); } }

document.addEventListener('DOMContentLoaded', async () => {
    createStars(60); updateClock(); setInterval(updateClock, 1000);
    await loadBerths(); await loadShips();
    // 启动潮汐定时器
    updateTide();
    if (tideInterval) clearInterval(tideInterval);
    tideInterval = setInterval(updateTide, 30000);
    document.getElementById('addShipBtn').addEventListener('click', addShip);
    document.getElementById('runSchedulerBtn').addEventListener('click', runSchedule);
    document.getElementById('openBerthConfigBtn').addEventListener('click', openBerthModal);
    document.getElementById('saveBerthConfigBtn').addEventListener('click', saveBerthModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeBerthModal);
    document.getElementById('resetDefaultInModalBtn').addEventListener('click', resetBerthsFromModal);
    document.getElementById('addBerthRowBtn').addEventListener('click', () => {
        const tbody = document.getElementById('modalBerthTbody');
        const newRow = tbody.insertRow();
        newRow.insertCell(0).innerHTML = `<input type="text" placeholder="新泊位ID" class="modal-id">`;
        newRow.insertCell(1).innerHTML = `<input type="number" step="0.1" placeholder="吃水" class="modal-depth">`;
        newRow.insertCell(2).innerHTML = `<input type="number" placeholder="岸桥数" class="modal-qc">`;
        newRow.insertCell(3).innerHTML = `<input type="number" placeholder="效率" class="modal-eff">`;
        newRow.insertCell(4).innerHTML = `<input type="number" placeholder="长度" class="modal-len">`;
        newRow.insertCell(5).innerHTML = `<button class="btn-icon" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button>`;
    });
});