// Global Chart Instances
let clicksChartInstance = null;
let referrerChartInstance = null;
let deviceChartInstance = null;

// Auth token storage
let apiToken = localStorage.getItem('linksnip_token') || null;
let currentPlanTier = 'free';
let currentUserEmail = '';

// Check Auth Status on Load
document.addEventListener('DOMContentLoaded', () => {
  checkAuthStatus();
});

// Helper: Show Toast Notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast active ${type}`;
  setTimeout(() => {
    toast.classList.remove('active');
  }, 4000);
}

// Fetch API Helper (Injects Bearer Token automatically)
async function fetchApi(url, options = {}) {
  options.headers = options.headers || {};
  if (apiToken) {
    options.headers['Authorization'] = `Bearer ${apiToken}`;
  }
  if (options.body && typeof options.body === 'object') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(url, options);
}

// Check if user is logged in
async function checkAuthStatus() {
  try {
    const res = await fetchApi('/api/auth/me');
    const data = await res.json();

    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const userEmailElem = document.getElementById('userEmail');
    const authWall = document.getElementById('dashboardAuthWall');
    const mainDashboard = document.getElementById('dashboardMain');

    const headerUpgrade = document.getElementById('headerUpgradeBtn');
    const barUpgrade = document.getElementById('barUpgradeBtn');
    const lblPlanTier = document.getElementById('lblPlanTier');

    if (data.loggedIn) {
      currentUserEmail = data.user.email;
      currentPlanTier = data.user.tier || 'free';
      
      loginBtn.style.display = 'none';
      userInfo.style.display = 'flex';
      userEmailElem.textContent = data.user.email;
      
      // Update plan labels & upgrade buttons
      if (currentPlanTier === 'pro') {
        lblPlanTier.textContent = 'Pro Tier ⭐';
        lblPlanTier.className = 'tier-labelpro';
        headerUpgrade.style.display = 'none';
        barUpgrade.style.display = 'none';
      } else {
        lblPlanTier.textContent = 'Free Tier';
        lblPlanTier.className = 'tier-labelfree';
        headerUpgrade.style.display = 'inline-block';
        barUpgrade.style.display = 'inline-block';
      }

      // Update API Key Manager
      updateApiKeyManagerUI(data.user.api_key);

      authWall.style.display = 'none';
      mainDashboard.style.display = 'block';
      
      // Load Links & Cache Stats
      loadLinks();
      loadCacheStats();
    } else {
      localStorage.removeItem('linksnip_token');
      apiToken = null;
      loginBtn.style.display = 'block';
      userInfo.style.display = 'none';
      
      authWall.style.display = 'block';
      mainDashboard.style.display = 'none';
    }
  } catch (err) {
    console.error('Error checking auth:', err);
  }
}

// Tab Switcher
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));

  document.getElementById(tabId).style.display = 'block';

  if (tabId === 'shortenerTab') {
    document.getElementById('navShortener').classList.add('active');
  }
  if (tabId === 'dashboardTab') {
    document.getElementById('navDashboard').classList.add('active');
    checkAuthStatus();
  }
}

// Single Form vs Bulk Form Switcher
function switchFormType(type) {
  const singleBtn = document.getElementById('singleTabBtn');
  const bulkBtn = document.getElementById('bulkTabBtn');
  const singleForm = document.getElementById('shortenForm');
  const bulkForm = document.getElementById('bulkShortenForm');

  if (type === 'single') {
    singleBtn.classList.add('active');
    bulkBtn.classList.remove('active');
    singleForm.style.display = 'block';
    bulkForm.style.display = 'none';
  } else {
    singleBtn.classList.remove('active');
    bulkBtn.classList.add('active');
    singleForm.style.display = 'none';
    bulkForm.style.display = 'block';
  }
}

// -------------------------------------------------------------
// AUTH MODAL & FLOWS
// -------------------------------------------------------------
function openAuthModal() {
  document.getElementById('authModal').classList.add('active');
  switchAuthTab('login');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('active');
}

function switchAuthTab(type) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotPasswordForm');
  const resetForm = document.getElementById('resetVerifyForm');
  const header = document.getElementById('authTabsHeader');
  const tabs = document.querySelectorAll('.auth-tab-btn');

  loginForm.style.display = 'none';
  registerForm.style.display = 'none';
  forgotForm.style.display = 'none';
  resetForm.style.display = 'none';
  header.style.display = 'flex';

  tabs.forEach(t => t.classList.remove('active'));

  if (type === 'login') {
    loginForm.style.display = 'block';
    tabs[0].classList.add('active');
  } else if (type === 'register') {
    registerForm.style.display = 'block';
    tabs[1].classList.add('active');
  }
}

function toggleForgotPassword(show) {
  const header = document.getElementById('authTabsHeader');
  const loginForm = document.getElementById('loginForm');
  const forgotForm = document.getElementById('forgotPasswordForm');

  if (show) {
    header.style.display = 'none';
    loginForm.style.display = 'none';
    forgotForm.style.display = 'block';
  } else {
    header.style.display = 'flex';
    loginForm.style.display = 'block';
    forgotForm.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetchApi('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Login failed.', 'error');
      return;
    }

    apiToken = data.token;
    localStorage.setItem('linksnip_token', data.token);
    closeAuthModal();
    showToast('Signed in successfully!', 'success');
    checkAuthStatus();
  } catch (err) {
    console.error('Login error:', err);
    showToast('Server connection error.', 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const res = await fetchApi('/api/auth/register', {
      method: 'POST',
      body: { email, password }
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Registration failed.', 'error');
      return;
    }

    showToast(data.message, 'success');
    switchAuthTab('login');
  } catch (err) {
    console.error('Register error:', err);
    showToast('Server connection error.', 'error');
  }
}

async function handleLogout() {
  try {
    const res = await fetchApi('/api/auth/logout', { method: 'POST' });
    if (res.ok) {
      localStorage.removeItem('linksnip_token');
      apiToken = null;
      showToast('Logged out successfully.', 'success');
      checkAuthStatus();
    }
  } catch (err) {
    console.error('Logout error:', err);
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('forgotEmail').value;
  if (!email) {
    showToast('Please enter your email.', 'error');
    return;
  }

  try {
    const res = await fetchApi('/api/auth/forgot-password', {
      method: 'POST',
      body: { email }
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Operation failed.', 'error');
      return;
    }

    showToast('Reset code sent! Check server console log.', 'success');
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('resetVerifyForm').style.display = 'block';
  } catch (err) {
    console.error('Forgot password error:', err);
  }
}

async function handleResetPassword() {
  const token = document.getElementById('resetToken').value;
  const password = document.getElementById('resetNewPassword').value;

  if (!token || !password) {
    showToast('Please fill all fields.', 'error');
    return;
  }

  try {
    const res = await fetchApi('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password }
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Password reset failed.', 'error');
      return;
    }

    showToast('Password reset successfully! Please sign in.', 'success');
    closeAuthModal();
  } catch (err) {
    console.error('Reset password error:', err);
  }
}

// -------------------------------------------------------------
// UPGRADE PLAN MOCK
// -------------------------------------------------------------
function openUpgradeModal() {
  document.getElementById('upgradeModal').classList.add('active');
}

function closeUpgradeModal() {
  document.getElementById('upgradeModal').classList.remove('active');
}

async function handleUpgradePayment(e) {
  e.preventDefault();
  
  try {
    const res = await fetchApi('/api/auth/upgrade', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('Payment successful! Welcome to LinkSnip Pro.', 'success');
      closeUpgradeModal();
      checkAuthStatus();
    } else {
      showToast(data.error || 'Upgrade failed.', 'error');
    }
  } catch (err) {
    console.error('Payment error:', err);
  }
}

// -------------------------------------------------------------
// API KEY MANAGER
// -------------------------------------------------------------
function updateApiKeyManagerUI(apiKey) {
  const noToken = document.getElementById('noTokenBox');
  const activeToken = document.getElementById('tokenActiveBox');
  const keyLabel = document.getElementById('apiKeyLabel');
  const curlTokenPlaceholder = document.getElementById('curlTokenPlaceholder');

  if (apiKey) {
    noToken.style.display = 'none';
    activeToken.style.display = 'block';
    keyLabel.textContent = apiKey;
    curlTokenPlaceholder.textContent = apiKey;
  } else {
    noToken.style.display = 'block';
    activeToken.style.display = 'none';
  }
}

async function generateApiKey() {
  try {
    const res = await fetchApi('/api/auth/api-key', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('API Key generated successfully!', 'success');
      updateApiKeyManagerUI(data.api_key);
    }
  } catch (err) {
    console.error('API key generate error:', err);
  }
}

async function revokeApiKey() {
  if (!confirm('Are you sure you want to revoke this API token? Any external app using it will stop working immediately.')) return;
  try {
    const res = await fetchApi('/api/auth/api-key', { method: 'DELETE' });
    if (res.ok) {
      showToast('API Key revoked.', 'success');
      updateApiKeyManagerUI(null);
    }
  } catch (err) {
    console.error('API key revoke error:', err);
  }
}

function copyApiKey() {
  const key = document.getElementById('apiKeyLabel').textContent;
  navigator.clipboard.writeText(key);
  showToast('API Key copied to clipboard!', 'success');
}

// -------------------------------------------------------------
// SHORTENING OPERATIONS
// -------------------------------------------------------------
async function getAISuggestions() {
  const targetUrl = document.getElementById('targetUrl').value;
  const title = document.getElementById('linkTitle').value;
  const suggestionsBox = document.getElementById('aiSuggestionsBox');
  const chipsContainer = document.getElementById('aliasChips');

  if (!targetUrl) {
    showToast('Please enter a destination long URL first.', 'error');
    return;
  }

  try {
    const res = await fetchApi('/api/ai/suggest-alias', {
      method: 'POST',
      body: { target_url: targetUrl, title }
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

let lastShortUrl = '';

async function handleShorten(e) {
  e.preventDefault();

  const target_url = document.getElementById('targetUrl').value;
  const custom_alias = document.getElementById('customAlias').value;
  const title = document.getElementById('linkTitle').value;
  const expire_at = document.getElementById('expireAt').value;
  const max_clicks = document.getElementById('maxClicks').value;
  const password = document.getElementById('linkPassword').value;
  const tags = document.getElementById('linkTags').value;
  const redirect_type = document.getElementById('redirectType').value;

  try {
    const res = await fetchApi('/api/shorten', {
      method: 'POST',
      body: {
        target_url,
        custom_alias,
        title,
        expire_at: expire_at ? new Date(expire_at).toISOString() : null,
        max_clicks: max_clicks ? parseInt(max_clicks) : null,
        password: password || null,
        tags,
        redirect_type: parseInt(redirect_type)
      }
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to shorten URL.', 'error');
      return;
    }

    const resultCard = document.getElementById('resultCard');
    const resultShortUrl = document.getElementById('resultShortUrl');
    const resultTargetUrl = document.getElementById('resultTargetUrl');
    const resultQrCode = document.getElementById('resultQrCode');
    const safetyBadge = document.getElementById('safetyBadge');
    const resultAiSummary = document.getElementById('resultAiSummary');

    lastShortUrl = data.link.short_url;
    resultShortUrl.href = data.link.short_url;
    resultShortUrl.textContent = data.link.short_url;
    resultTargetUrl.textContent = `Destination: ${data.link.target_url}`;
    
    // Set custom colors based on pickers
    const darkColor = document.getElementById('qrColorDark').value;
    const lightColor = document.getElementById('qrColorLight').value;
    resultQrCode.src = `/api/qr?url=${encodeURIComponent(lastShortUrl)}&dark=${encodeURIComponent(darkColor)}&light=${encodeURIComponent(lightColor)}`;

    const safety = data.link.safety_report;
    if (safety) {
      resultAiSummary.textContent = safety.summary;
      safetyBadge.className = `safety-badge ${safety.riskLevel.toLowerCase().replace(' ', '')}`;
      safetyBadge.textContent = `🛡️ AI Safety: ${safety.safetyScore}% (${safety.riskLevel})`;
    }

    resultCard.classList.add('active');
    resultCard.scrollIntoView({ behavior: 'smooth' });
    showToast('Link shortened successfully!', 'success');

  } catch (err) {
    console.error('Error shortening URL:', err);
    showToast('Server communication error.', 'error');
  }
}

// Regenerate QR Code on color change
function regenerateQrCode() {
  if (!lastShortUrl) return;
  const darkColor = document.getElementById('qrColorDark').value;
  const lightColor = document.getElementById('qrColorLight').value;
  const resultQrCode = document.getElementById('resultQrCode');
  resultQrCode.src = `/api/qr?url=${encodeURIComponent(lastShortUrl)}&dark=${encodeURIComponent(darkColor)}&light=${encodeURIComponent(lightColor)}`;
}

function downloadQrCode() {
  if (!lastShortUrl) return;
  const darkColor = document.getElementById('qrColorDark').value;
  const lightColor = document.getElementById('qrColorLight').value;
  const url = `/api/qr?url=${encodeURIComponent(lastShortUrl)}&dark=${encodeURIComponent(darkColor)}&light=${encodeURIComponent(lightColor)}`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `qrcode_${generateRandomCode(6)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function handleBulkShorten(e) {
  e.preventDefault();
  const csv = document.getElementById('bulkCsvInput').value;

  if (!csv.trim()) {
    showToast('Please enter some CSV content.', 'error');
    return;
  }

  try {
    const res = await fetchApi('/api/bulk-shorten', {
      method: 'POST',
      body: { csv }
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Bulk shorten failed.', 'error');
      return;
    }

    const bulkCard = document.getElementById('bulkResultCard');
    const bulkList = document.getElementById('bulkResultsList');
    
    document.getElementById('bulkResultTitle').textContent = `🎉 Processed ${data.count} Links Successfully!`;
    bulkList.innerHTML = '';

    data.links.forEach(l => {
      const item = document.createElement('div');
      item.className = 'bulk-item';
      item.innerHTML = `
        <span>🏷️ ${l.title || l.short_code}</span>
        <a href="${l.short_url}" target="_blank">${l.short_url}</a>
      `;
      bulkList.appendChild(item);
    });

    bulkCard.classList.add('active');
    bulkCard.scrollIntoView({ behavior: 'smooth' });
    showToast('Bulk shortening complete!', 'success');
  } catch (err) {
    console.error('Bulk shortening error:', err);
    showToast('Server communication error.', 'error');
  }
}

// Copy URLs
function copyResultUrl() {
  const shortUrl = document.getElementById('resultShortUrl').href;
  navigator.clipboard.writeText(shortUrl);
  showToast('Short URL copied to clipboard!', 'success');
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  showToast('Link copied to clipboard!', 'success');
}

// -------------------------------------------------------------
// DASHBOARD & LINK MANAGEMENT
// -------------------------------------------------------------
async function loadLinks() {
  const search = document.getElementById('searchInput').value;
  const sort = document.getElementById('sortSelect').value;

  try {
    const res = await fetchApi(`/api/links?search=${encodeURIComponent(search)}&sort=${sort}`);
    
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }

    const data = await res.json();
    const tbody = document.getElementById('linksTableBody');
    tbody.innerHTML = '';

    // Update Overview Cards
    const totalClicks = data.links.reduce((acc, l) => acc + (l.click_count || 0), 0);
    document.getElementById('cardTotalClicks').textContent = totalClicks;
    document.getElementById('cardActiveLinks').textContent = data.links.length;

    const lblUsage = document.getElementById('lblPlanUsage');
    const progressBar = document.getElementById('progressBarFill');

    if (currentPlanTier === 'pro') {
      lblUsage.textContent = `Usage: ${data.links.length} / Unlimited`;
      progressBar.style.width = '100%';
      document.getElementById('cardActiveDesc').textContent = 'Pro Tier (Unlimited)';
    } else {
      lblUsage.textContent = `Usage: ${data.links.length} / 15 Links`;
      const percentage = Math.min((data.links.length / 15) * 100, 100);
      progressBar.style.width = `${percentage}%`;
      document.getElementById('cardActiveDesc').textContent = `${data.links.length}/15 free limit`;
    }

    if (data.links.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No links found. Create your first link!</td></tr>`;
      return;
    }

    data.links.forEach(link => {
      const tr = document.createElement('tr');
      const tagsHtml = link.tags ? link.tags.split(',').map(t => `<span class="badge-tag">${t.trim()}</span>`).join(' ') : '<span style="color: var(--text-muted); font-size: 11px;">No tags</span>';
      
      const isChecked = (link.is_enabled === undefined || link.is_enabled === 1 || link.is_enabled === true);

      tr.innerHTML = `
        <td style="text-align: center;">
          <input type="checkbox" class="row-checkbox" value="${link.id}" onchange="checkBulkButtonVisibility()">
        </td>
        <td>
          <div style="font-weight: 700; color: #fff;">${link.title || link.short_code}</div>
          <a href="${link.short_url}" target="_blank" style="color: #67e8f9; font-size: 13px; font-weight: 600; text-decoration: none;">${link.short_url}</a>
        </td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 13px;">
          ${link.target_url}
        </td>
        <td>
          <span style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 13px;">
            📊 ${link.click_count}
          </span>
        </td>
        <td>
          <span style="font-size: 12px; font-weight: 700; color: ${link.redirect_type === 301 ? '#10b981' : '#a855f7'}; background: ${link.redirect_type === 301 ? 'rgba(16,185,129,0.1)' : 'rgba(168,85,247,0.1)'}; padding: 3px 8px; border-radius: 6px;">
            ${link.redirect_type || 302}
          </span>
        </td>
        <td>
          <div style="margin-bottom: 4px;">${tagsHtml}</div>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${link.has_password ? '🔒 Pass' : ''} 
            ${link.expire_at ? '⏰ Exp' : ''}
            ${link.max_clicks ? `🔢 Limit: ${link.max_clicks}` : ''}
          </div>
        </td>
        <td>
          <label class="switch">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleLinkStatus(${link.id}, this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="copyText('${link.short_url}')">📋 Copy</button>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px; background: rgba(6, 182, 212, 0.15); border-color: #06b6d4;" onclick="openEditModal(${JSON.stringify(link).replace(/"/g, '&quot;')})">✏️ Edit</button>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px; background: rgba(6, 182, 212, 0.2); border-color: #06b6d4;" onclick="openAnalyticsModal(${link.id})">📈 Stats</button>
          <button class="btn-secondary" style="padding: 6px 10px; font-size: 12px; background: rgba(244, 63, 94, 0.2); border-color: #f43f5e; color: #f87171;" onclick="deleteLink(${link.id})">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('selectAllCheckbox').checked = false;
    checkBulkButtonVisibility();

  } catch (err) {
    console.error('Error loading links:', err);
  }
}

async function loadCacheStats() {
  try {
    const res = await fetchApi('/api/cache/stats');
    const data = await res.json();
    document.getElementById('cardCacheRate').textContent = data.hitRate || '0.0%';
    document.getElementById('cardCacheRatio').textContent = `Hits: ${data.hits} | Misses: ${data.misses}`;
  } catch (err) {
    console.error('Error fetching cache stats:', err);
  }
}

// Bulk Checkbox Handling
function toggleSelectAll(isChecked) {
  const checkboxes = document.querySelectorAll('.row-checkbox');
  checkboxes.forEach(c => c.checked = isChecked);
  checkBulkButtonVisibility();
}

function checkBulkButtonVisibility() {
  const selected = document.querySelectorAll('.row-checkbox:checked');
  const btn = document.getElementById('bulkDeleteBtn');
  if (selected.length > 0) {
    btn.style.display = 'inline-block';
    btn.textContent = `🗑️ Delete Selected (${selected.length})`;
  } else {
    btn.style.display = 'none';
  }
}

async function handleBulkDelete() {
  const selected = document.querySelectorAll('.row-checkbox:checked');
  if (selected.length === 0) return;

  if (!confirm(`Are you sure you want to archive all ${selected.length} selected links?`)) return;

  const ids = Array.from(selected).map(c => parseInt(c.value, 10));
  try {
    const res = await fetchApi('/api/links/bulk-delete', {
      method: 'POST',
      body: { ids }
    });
    if (res.ok) {
      showToast('Selected links archived successfully.', 'success');
      loadLinks();
    } else {
      showToast('Failed to delete selected links.', 'error');
    }
  } catch (err) {
    console.error('Bulk delete error:', err);
  }
}

async function toggleLinkStatus(linkId, isChecked) {
  try {
    const res = await fetchApi(`/api/links/${linkId}`, {
      method: 'PUT',
      body: { is_enabled: isChecked }
    });
    const data = await res.json();
    if (res.ok) {
      showToast(isChecked ? 'Link enabled.' : 'Link disabled.', 'success');
    } else {
      showToast(data.error || 'Failed to update link.', 'error');
    }
  } catch (err) {
    console.error('Error toggling link status:', err);
  }
}

function openEditModal(link) {
  document.getElementById('editLinkId').value = link.id;
  document.getElementById('editTitle').value = link.title || '';
  document.getElementById('editTargetUrl').value = link.target_url || '';
  document.getElementById('editRedirectType').value = link.redirect_type || 302;
  
  if (link.expire_at) {
    const expDate = new Date(link.expire_at);
    const localISO = new Date(expDate.getTime() - expDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('editExpireAt').value = localISO;
  } else {
    document.getElementById('editExpireAt').value = '';
  }

  document.getElementById('editMaxClicks').value = link.max_clicks || '';
  document.getElementById('editTags').value = link.tags || '';
  
  document.getElementById('editLinkModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editLinkModal').classList.remove('active');
}

async function handleSaveEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editLinkId').value;
  const title = document.getElementById('editTitle').value;
  const target_url = document.getElementById('editTargetUrl').value;
  const expire_at = document.getElementById('editExpireAt').value;
  const max_clicks = document.getElementById('editMaxClicks').value;
  const tags = document.getElementById('editTags').value;
  const redirect_type = document.getElementById('editRedirectType').value;

  try {
    const res = await fetchApi(`/api/links/${id}`, {
      method: 'PUT',
      body: {
        title,
        target_url,
        expire_at: expire_at ? new Date(expire_at).toISOString() : null,
        max_clicks: max_clicks ? parseInt(max_clicks) : null,
        tags,
        redirect_type: parseInt(redirect_type)
      }
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Link updated successfully.', 'success');
      closeEditModal();
      loadLinks();
    } else {
      showToast(data.error || 'Failed to update link.', 'error');
    }
  } catch (err) {
    console.error('Save edit error:', err);
  }
}

async function deleteLink(linkId) {
  if (!confirm('Are you sure you want to delete/archive this link?')) return;

  try {
    const res = await fetchApi(`/api/links/${linkId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Link archived successfully.', 'success');
      loadLinks();
    } else {
      showToast('Failed to delete link.', 'error');
    }
  } catch (err) {
    console.error('Delete link error:', err);
  }
}

// Helper: Generate random string
function generateRandomCode(length = 6) {
  const charset = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

// -------------------------------------------------------------
// ANALYTICS & VISUALIZATIONS
// -------------------------------------------------------------
async function openAnalyticsModal(linkId) {
  try {
    const modal = document.getElementById('analyticsModal');
    modal.classList.add('active');

    const [analyticsRes, aiRes] = await Promise.all([
      fetchApi(`/api/analytics/${linkId}`).then(r => r.json()),
      fetchApi(`/api/ai/insights/${linkId}`).then(r => r.json())
    ]);

    document.getElementById('modalLinkTitle').textContent = analyticsRes.link.title || `Link: ${analyticsRes.link.short_code}`;
    
    const protocol = window.location.protocol;
    const host = window.location.host;
    const fullShortUrl = `${protocol}//${host}/${analyticsRes.link.short_code}`;
    
    const shortUrlElem = document.getElementById('modalShortUrl');
    shortUrlElem.href = fullShortUrl;
    shortUrlElem.textContent = fullShortUrl;

    const modalCsv = document.getElementById('modalExportCsv');
    modalCsv.href = `/api/export/${linkId}`;

    // Render AI Insights
    document.getElementById('aiExecutiveSummary').textContent = aiRes.executiveSummary || 'No data yet.';
    const recList = document.getElementById('aiRecommendationsList');
    recList.innerHTML = '';
    (aiRes.recommendations || []).forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      recList.appendChild(li);
    });

    renderCharts(analyticsRes);
  } catch (err) {
    console.error('Error opening analytics:', err);
    showToast('Failed to fetch analytics.', 'error');
  }
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').classList.remove('active');
}

function renderCharts(data) {
  const timelineCtx = document.getElementById('clicksChart').getContext('2d');
  const dates = Object.keys(data.clicks_over_time);
  const counts = Object.values(data.clicks_over_time);

  if (clicksChartInstance) clicksChartInstance.destroy();
  clicksChartInstance = new Chart(timelineCtx, {
    type: 'line',
    data: {
      labels: dates.length ? dates : [new Date().toISOString().substring(0, 10)],
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
