// Global Chart Instances
let clicksChartInstance = null;
let referrerChartInstance = null;
let deviceChartInstance = null;

// Tab Switcher
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));

  document.getElementById(tabId).style.display = 'block';

  if (tabId === 'shortenerTab') document.getElementById('navShortener').classList.add('active');
  if (tabId === 'dashboardTab') {
    document.getElementById('navDashboard').classList.add('active');
    loadLinks();
  }
  if (tabId === 'apiTab') document.getElementById('navApi').classList.add('active');
}

// AI Smart Alias Suggestions
async function getAISuggestions() {
  const targetUrl = document.getElementById('targetUrl').value;
  const title = document.getElementById('linkTitle').value;
  const suggestionsBox = document.getElementById('aiSuggestionsBox');
  const chipsContainer = document.getElementById('aliasChips');

  if (!targetUrl) {
    alert('Please enter a destination long URL first to generate AI suggestions.');
    return;
  }

  try {
    const res = await fetch('/api/ai/suggest-alias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_url: targetUrl, title })
    });
    const data = await res.json();

    if (data.suggestions && data.suggestions.length > 0) {
      chipsContainer.innerHTML = '';
      data.suggestions.forEach(alias => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = alias;
        chip.onclick = () => {
          document.getElementById('customAlias').value = alias;
        };
        chipsContainer.appendChild(chip);
      });
      suggestionsBox.classList.add('active');
    }
  } catch (err) {
    console.error('Error getting AI suggestions:', err);
  }
}

// Handle Link Shortening
async function handleShorten(e) {
  e.preventDefault();

  const target_url = document.getElementById('targetUrl').value;
  const custom_alias = document.getElementById('customAlias').value;
  const title = document.getElementById('linkTitle').value;
  const expire_at = document.getElementById('expireAt').value;
  const max_clicks = document.getElementById('maxClicks').value;
  const password = document.getElementById('linkPassword').value;
  const tags = document.getElementById('linkTags').value;

  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_url,
        custom_alias,
        title,
        expire_at: expire_at ? new Date(expire_at).toISOString() : null,
        max_clicks,
        password,
        tags
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Failed to shorten URL.');
      return;
    }

    // Render Result
    const resultCard = document.getElementById('resultCard');
    const resultShortUrl = document.getElementById('resultShortUrl');
    const resultTargetUrl = document.getElementById('resultTargetUrl');
    const resultQrCode = document.getElementById('resultQrCode');
    const safetyBadge = document.getElementById('safetyBadge');
    const resultAiSummary = document.getElementById('resultAiSummary');

    resultShortUrl.href = data.link.short_url;
    resultShortUrl.textContent = data.link.short_url;
    resultTargetUrl.textContent = `Destination: ${data.link.target_url}`;
    resultQrCode.src = data.link.qr_code;

    const safety = data.link.safety_report;
    if (safety) {
      resultAiSummary.textContent = safety.summary;
      safetyBadge.className = `safety-badge ${safety.riskLevel.toLowerCase().replace(' ', '')}`;
      safetyBadge.textContent = `🛡️ AI Safety: ${safety.safetyScore}% (${safety.riskLevel})`;
    }

    resultCard.classList.add('active');
    resultCard.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    console.error('Error shortening link:', err);
    alert('An unexpected error occurred.');
  }
}

// Copy URL to Clipboard
function copyResultUrl() {
  const shortUrl = document.getElementById('resultShortUrl').href;
  navigator.clipboard.writeText(shortUrl);
  alert('Short URL copied to clipboard! 📋');
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  alert(`Copied: ${text}`);
}

// Load Links into Dashboard
async function loadLinks() {
  const search = document.getElementById('searchInput').value;
  const sort = document.getElementById('sortSelect').value;

  try {
    const res = await fetch(`/api/links?search=${encodeURIComponent(search)}&sort=${sort}`);
    const data = await res.json();

    const tbody = document.getElementById('linksTableBody');
    tbody.innerHTML = '';

    if (data.links.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">No links found. Create your first link!</td></tr>`;
      return;
    }

    data.links.forEach(link => {
      const tr = document.createElement('tr');

      const tagsHtml = link.tags ? link.tags.split(',').map(t => `<span class="badge-tag">${t.trim()}</span>`).join(' ') : '<span style="color: var(--text-muted); font-size: 12px;">No tags</span>';
      
      tr.innerHTML = `
        <td>
          <div style="font-weight: 700; color: #fff;">${link.title || link.short_code}</div>
          <a href="${link.short_url}" target="_blank" style="color: #67e8f9; font-size: 13px; font-weight: 600; text-decoration: none;">${link.short_url}</a>
        </td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 13px;">
          ${link.target_url}
        </td>
        <td>
          <span style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 13px;">
            📊 ${link.click_count}
          </span>
        </td>
        <td>
          ${tagsHtml}
          ${link.has_password ? ' 🔒' : ''}
          ${link.expire_at ? ' ⏰' : ''}
        </td>
        <td>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="copyText('${link.short_url}')">📋 Copy</button>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px; background: rgba(6, 182, 212, 0.2); border-color: #06b6d4;" onclick="openAnalyticsModal(${link.id})">📈 Stats</button>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px; background: rgba(244, 63, 94, 0.2); border-color: #f43f5e; color: #f87171;" onclick="deleteLink(${link.id})">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading links:', err);
  }
}

// Delete Link
async function deleteLink(linkId) {
  if (!confirm('Are you sure you want to archive this short link?')) return;

  try {
    await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
    loadLinks();
  } catch (err) {
    console.error('Error deleting link:', err);
  }
}

// Open Analytics Modal
async function openAnalyticsModal(linkId) {
  try {
    const modal = document.getElementById('analyticsModal');
    modal.classList.add('active');

    // Fetch Analytics Data & AI Insights
    const [analyticsRes, aiRes] = await Promise.all([
      fetch(`/api/analytics/${linkId}`).then(r => r.json()),
      fetch(`/api/ai/insights/${linkId}`).then(r => r.json())
    ]);

    document.getElementById('modalLinkTitle').textContent = analyticsRes.link.title || `Link: ${analyticsRes.link.short_code}`;
    const shortUrlElem = document.getElementById('modalShortUrl');
    const protocol = window.location.protocol;
    const host = window.location.host;
    const fullShortUrl = `${protocol}//${host}/${analyticsRes.link.short_code}`;
    shortUrlElem.href = fullShortUrl;
    shortUrlElem.textContent = fullShortUrl;

    document.getElementById('modalExportCsv').href = `/api/export/${linkId}`;

    // Render AI Insights
    document.getElementById('aiExecutiveSummary').textContent = aiRes.executiveSummary || 'No data yet.';
    const recList = document.getElementById('aiRecommendationsList');
    recList.innerHTML = '';
    (aiRes.recommendations || []).forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      recList.appendChild(li);
    });

    // Render Charts
    renderCharts(analyticsRes);

  } catch (err) {
    console.error('Error opening analytics modal:', err);
  }
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').classList.remove('active');
}

// Render Chart.js Visualizations
function renderCharts(data) {
  // 1. Clicks Timeline Chart
  const timelineCtx = document.getElementById('clicksChart').getContext('2d');
  const dates = Object.keys(data.clicks_over_time);
  const counts = Object.values(data.clicks_over_time);

  if (clicksChartInstance) clicksChartInstance.destroy();
  clicksChartInstance = new Chart(timelineCtx, {
    type: 'line',
    data: {
      labels: dates.length ? dates : [new Date().toISOString().substring(0,10)],
      datasets: [{
        label: 'Clicks',
        data: counts.length ? counts : [0],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
      }
    }
  });

  // 2. Referrers Pie Chart
  const refCtx = document.getElementById('referrerChart').getContext('2d');
  const refLabels = Object.keys(data.referrers);
  const refData = Object.values(data.referrers);

  if (referrerChartInstance) referrerChartInstance.destroy();
  referrerChartInstance = new Chart(refCtx, {
    type: 'pie',
    data: {
      labels: refLabels.length ? refLabels : ['Direct / Organic'],
      datasets: [{
        data: refData.length ? refData : [1],
        backgroundColor: ['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b']
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
    }
  });

  // 3. Devices Doughnut Chart
  const devCtx = document.getElementById('deviceChart').getContext('2d');
  const devLabels = Object.keys(data.devices);
  const devData = Object.values(data.devices);

  if (deviceChartInstance) deviceChartInstance.destroy();
  deviceChartInstance = new Chart(devCtx, {
    type: 'doughnut',
    data: {
      labels: devLabels.length ? devLabels : ['Desktop'],
      datasets: [{
        data: devData.length ? devData : [1],
        backgroundColor: ['#06b6d4', '#a855f7', '#f43f5e']
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
    }
  });
}
