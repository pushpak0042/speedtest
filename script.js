const startTestBtn = document.getElementById('startTestBtn');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const pingValue = document.getElementById('pingValue');
const downloadValue = document.getElementById('downloadValue');
const uploadValue = document.getElementById('uploadValue');
const jitterValue = document.getElementById('jitterValue');
const downloadResult = document.getElementById('downloadResult');
const qualityBadge = document.getElementById('qualityBadge');
const latencySummary = document.getElementById('latencySummary');
const pingCaption = document.getElementById('pingCaption');
const jitterCaption = document.getElementById('jitterCaption');
const providerName = document.getElementById('providerName');
const deviceIp = document.getElementById('deviceIp');
const connectionType = document.getElementById('connectionType');
const technologyName = document.getElementById('technologyName');
const locationName = document.getElementById('locationName');
const liveSpeed = document.getElementById('liveSpeed');
const serverSelect = document.getElementById('serverSelect');
const serverName = document.getElementById('serverName');
const historyToggleBtn = document.getElementById('historyToggleBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const resultsPanel = document.getElementById('resultsPanel');
const historyTableBody = document.getElementById('historyTableBody');
let testRunning = false;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function sanitizeText(value, fallback = 'Unknown') {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[<>"'`]/g, '').trim();
  return cleaned || fallback;
}

function getQuality(downloadMbps) {
  if (downloadMbps >= 200) return 'Excellent';
  if (downloadMbps >= 100) return 'Very good';
  if (downloadMbps >= 50) return 'Good';
  if (downloadMbps >= 20) return 'Fair';
  return 'Basic';
}

function pictogram(percent) {
  if (percent >= 90) return 'Super fast';
  if (percent >= 70) return 'Strong connection';
  if (percent >= 45) return 'Stable network';
  return 'Testing network';
}

function animateText(element, start, end, suffix = '', duration = 750) {
  const startTime = performance.now();

  function step(now) {
    const progress = clamp((now - startTime) / duration, 0, 1);
    const current = start + (end - start) * progress;
    element.textContent = `${current.toFixed(current >= 10 ? 0 : 1)}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function updateProgress(value) {
  progressBar.style.width = `${value}%`;
  progressPercent.textContent = `${Math.round(value)}%`;
}

function updateConnectionMeta() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = connection?.effectiveType || 'Unknown';
  const technology = connection?.type || (connection?.effectiveType ? `${connection.effectiveType} network` : 'Browser unavailable');
  const downlink = connection?.downlink || 25;
  const rtt = connection?.rtt || 35;

  connectionType.textContent = networkType.toUpperCase();
  technologyName.textContent = sanitizeText(technology, 'Browser unavailable');
  latencySummary.textContent = `${Math.round(rtt)} ms`;

  if (!testRunning) {
    const liveValue = clamp(downlink, 0.1, 500);
    liveSpeed.textContent = `${liveValue.toFixed(1)} Mbps`;
  }
}

async function detectNetworkInfo() {
  try {
    const response = await fetch('/api/network', { cache: 'no-store' });
    if (!response.ok) throw new Error('network api failed');
    const data = await response.json();

    providerName.textContent = sanitizeText(data.provider || 'Unknown provider', 'Unknown provider');
    deviceIp.textContent = sanitizeText(data.clientIp || 'Unavailable', 'Unavailable');
    locationName.textContent = sanitizeText(data.location || 'Location unavailable', 'Location unavailable');
    return;
  } catch {
    try {
      const response = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
      if (!response.ok) throw new Error('ipapi failed');
      const data = await response.json();
      const ip = sanitizeText(data.ip, 'Unavailable');
      const org = sanitizeText(data.org || data.isp || 'Unknown provider', 'Unknown provider');
      const city = sanitizeText(data.city || 'Unknown city', 'Unknown city');
      const region = sanitizeText(data.region || 'Unknown region', 'Unknown region');
      deviceIp.textContent = ip;
      providerName.textContent = org;
      locationName.textContent = `${city}, ${region}`;
    } catch {
      deviceIp.textContent = 'Unavailable';
      providerName.textContent = 'Network provider unavailable';
      locationName.textContent = 'Location unavailable';
    }
  }
}

function saveHistoryEntry(entry) {
  const history = JSON.parse(localStorage.getItem('netpulse-history') || '[]');
  history.unshift(entry);
  localStorage.setItem('netpulse-history', JSON.stringify(history.slice(0, 8)));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('netpulse-history') || '[]');
  if (!history.length) {
    historyTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No results yet</td></tr>';
    return;
  }

  historyTableBody.replaceChildren(...history.map((entry) => {
    const row = document.createElement('tr');
    [entry.time, entry.server, `${entry.ping} ms`, `${entry.download} Mbps`, `${entry.upload} Mbps`]
      .forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = sanitizeText(String(value));
        row.appendChild(cell);
      });
    return row;
  }));
}

function toggleHistoryPanel() {
  resultsPanel.classList.toggle('hidden');
  historyToggleBtn.textContent = resultsPanel.classList.contains('hidden') ? 'History' : 'Hide history';
}

function pingEndpoint() {
  const started = performance.now();
  return fetch('/api/ping', { method: 'GET', cache: 'no-store' })
    .then((response) => response.json())
    .then(() => {
      const elapsed = performance.now() - started;
      return elapsed;
    });
}

async function readDownloadStream(response, totalBytes, progressStart, progressEnd) {
  if (!response.ok || !response.body) throw new Error('Download stream unavailable');

  const reader = response.body.getReader();
  let receivedBytes = 0;
  let latestSpeed = 0;
  const started = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    const elapsedSeconds = (performance.now() - started) / 1000;
    latestSpeed = (receivedBytes * 8) / elapsedSeconds / 1000000;
    const progress = progressStart + (receivedBytes / totalBytes) * (progressEnd - progressStart);
    updateProgress(progress);
    liveSpeed.textContent = `${latestSpeed.toFixed(1)} Mbps`;
    downloadResult.textContent = latestSpeed.toFixed(0);
  }

  const elapsedSeconds = (performance.now() - started) / 1000;
  return (receivedBytes * 8) / elapsedSeconds / 1000000;
}

async function downloadSpeedTest() {
  const laneCount = 4;
  const bytesPerLane = 8 * 1024 * 1024;
  const started = performance.now();
  let latestSpeed = 0;
  const lanes = Array.from({ length: laneCount }, (_, lane) => fetch(
    `/api/download?bytes=${bytesPerLane}&lane=${lane}&t=${Date.now()}-${lane}`,
    { cache: 'no-store' }
  ).then((response) => readDownloadStream(response, bytesPerLane, 35, 68))
    .then((speed) => {
      latestSpeed = Math.max(latestSpeed, speed);
      return speed;
    }));

  const laneSpeeds = await Promise.all(lanes);
  const totalBytes = laneCount * bytesPerLane;
  const elapsedSeconds = (performance.now() - started) / 1000;
  const aggregateMbps = (totalBytes * 8) / elapsedSeconds / 1000000;
  return Math.max(aggregateMbps, latestSpeed, laneSpeeds.reduce((sum, speed) => sum + speed, 0) / laneCount);
}

async function uploadSpeedTest() {
  const payloadSizeMb = 8;
  const payloadBytes = new Uint8Array(payloadSizeMb * 1024 * 1024);
  for (let i = 0; i < payloadBytes.length; i += 1) payloadBytes[i] = i % 251;

  const started = performance.now();
  const response = await fetch(`/api/upload?t=${Date.now()}`, {
    method: 'POST',
    body: payloadBytes,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/octet-stream' }
  });
  if (!response.ok) throw new Error('Upload test failed');
  const data = await response.json();
  const elapsedSeconds = (performance.now() - started) / 1000;
  return (data.bytesReceived * 8) / elapsedSeconds / 1000000;
}

async function runSpeedTest() {
  testRunning = true;
  startTestBtn.disabled = true;
  startTestBtn.textContent = 'Running test...';
  updateProgress(5);
  pingCaption.textContent = 'Checking latency';
  jitterCaption.textContent = 'Measuring jitter';

  try {
    const pingTimes = [];
    for (let i = 0; i < 3; i += 1) {
      const time = await pingEndpoint();
      pingTimes.push(time);
      updateProgress(18 + (i + 1) * 10);
      pingValue.textContent = `${Math.round(time)} ms`;
      latencySummary.textContent = `${Math.round(time)} ms`;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const avgPing = pingTimes.reduce((sum, value) => sum + value, 0) / pingTimes.length;
    const pingTarget = avgPing;
    const jitterTarget = pingTimes.reduce((sum, value) => sum + Math.abs(value - avgPing), 0) / pingTimes.length;

    pingValue.textContent = `${Math.round(pingTarget)} ms`;
    jitterValue.textContent = `${Math.round(jitterTarget)} ms`;
    pingCaption.textContent = 'Latency measured';
    jitterCaption.textContent = 'Jitter estimated';
    updateProgress(35);

    pingCaption.textContent = 'Download is running';
    const downloadMbps = await downloadSpeedTest();
    updateProgress(68);
    animateText(downloadValue, Number.parseFloat(downloadValue.textContent) || 0, downloadMbps, ' Mbps', 700);
    animateText(downloadResult, Number.parseFloat(downloadResult.textContent) || 0, downloadMbps, ' ', 700);
    liveSpeed.textContent = `${downloadMbps.toFixed(1)} Mbps`;
    qualityBadge.textContent = getQuality(downloadMbps);

    pingCaption.textContent = 'Upload is running';
    const uploadMbps = await uploadSpeedTest();
    updateProgress(100);
    animateText(uploadValue, Number.parseFloat(uploadValue.textContent) || 0, uploadMbps, ' Mbps', 700);

    pingCaption.textContent = 'Final score ready';
    jitterCaption.textContent = 'Stable';
    qualityBadge.textContent = getQuality(downloadMbps);
    latencySummary.textContent = `${Math.round(pingTarget)} ms`;
    downloadResult.textContent = downloadMbps.toFixed(0);
    liveSpeed.textContent = `${downloadMbps.toFixed(1)} Mbps`;

    const currentServer = serverSelect.value;
    serverName.textContent = currentServer;
    saveHistoryEntry({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      server: currentServer,
      ping: Math.round(pingTarget),
      download: downloadMbps.toFixed(1),
      upload: uploadMbps.toFixed(1)
    });

    startTestBtn.disabled = false;
    startTestBtn.textContent = 'Start test';
  } catch (error) {
    pingCaption.textContent = 'Test failed';
    jitterCaption.textContent = 'Retry';
    qualityBadge.textContent = 'Basic';
    startTestBtn.disabled = false;
    startTestBtn.textContent = 'Retry';
    testRunning = false;
    console.error(error);
  }
}

startTestBtn.addEventListener('click', runSpeedTest);
serverSelect.addEventListener('change', (event) => {
  serverName.textContent = event.target.value;
});
historyToggleBtn.addEventListener('click', toggleHistoryPanel);
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem('netpulse-history');
  renderHistory();
});

updateProgress(0);
pingValue.textContent = '0 ms';
downloadValue.textContent = '0 Mbps';
uploadValue.textContent = '0 Mbps';
jitterValue.textContent = '0 ms';
downloadResult.textContent = '0';
qualityBadge.textContent = 'Excellent';
latencySummary.textContent = '0 ms';
pingCaption.textContent = 'Waiting for test';
jitterCaption.textContent = 'Ready';
providerName.textContent = 'Detecting…';
deviceIp.textContent = 'Detecting…';
connectionType.textContent = 'Detecting…';
locationName.textContent = 'Detecting…';
technologyName.textContent = 'Detecting…';
liveSpeed.textContent = '0.0 Mbps';
serverName.textContent = serverSelect.value;
resultsPanel.classList.remove('hidden');
renderHistory();

updateConnectionMeta();
detectNetworkInfo();
setInterval(updateConnectionMeta, 2000);
