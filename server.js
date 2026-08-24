const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { dbAsync } = require('./database');
const { encodeBase62, generateRandomCode, isValidAlias } = require('./utils/base62');
const { parseUserAgent, deriveGeoLocation } = require('./utils/geoDeviceParser');
const { suggestSmartAliases, analyzeUrlSafety, generateClickInsights } = require('./utils/aiEngine');
const { sendEmail } = require('./utils/email');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'linksnip-jwt-super-secret-key-12345';
const SESSION_SECRET = process.env.SESSION_SECRET || 'linksnip-session-super-secret-key-12345';

// -------------------------------------------------------------
// RATE LIMITERS & SESSION
// -------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again after 15 minutes.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many authentication attempts, please try again after 15 minutes.' }
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Normalize URL
function normalizeUrl(urlStr) {
  if (!urlStr) return '';
  let trimmed = urlStr.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  return trimmed;
}

// Helper: Get real accessible URL for short links
function getBaseUrl(req) {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  return `${protocol}://${host}`;
}

// -------------------------------------------------------------
// SWAGGER OPENAPI SPECIFICATION
// -------------------------------------------------------------
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'LinkSnip REST API',
    version: '2.0.0',
    description: 'Scalable production URL Shortening, User Management, API Key Access, and Cache-Optimized redirection API.'
  },
  servers: [{ url: '/api' }],
  paths: {
    '/auth/register': {
      post: {
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } } }
        },
        responses: { 201: { description: 'Registration successful' } }
      }
    },
    '/auth/login': {
      post: {
        summary: 'Log in',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } } }
        },
        responses: { 200: { description: 'Login successful' } }
      }
    },
    '/shorten': {
      post: {
        summary: 'Shorten a long URL',
        security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { target_url: { type: 'string' }, custom_alias: { type: 'string' }, redirect_type: { type: 'integer', example: 302 }, expire_at: { type: 'string' }, max_clicks: { type: 'integer' }, tags: { type: 'string' }, password: { type: 'string' } }, required: ['target_url'] } } }
        },
        responses: { 201: { description: 'Short link created successfully' } }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
    }
  }
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// -------------------------------------------------------------
// AUTH RESOLVER & MIDDLEWARES
// -------------------------------------------------------------
async function resolveUser(req, res, next) {
  req.user = null;

  // 1. Header API Key check (e.g. X-API-Key or Authorization header)
  const apiKey = req.headers['x-api-key'] || req.headers['api-key'];
  if (apiKey) {
    const user = await dbAsync.get('SELECT * FROM users WHERE api_key = ?', [apiKey]);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 2. Session check
  if (req.session && req.session.userId) {
    const user = await dbAsync.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 3. JWT token check
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      // Check if it's a JWT
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await dbAsync.get('SELECT * FROM users WHERE id = ?', [decoded.userId]);
      if (user) {
        req.user = user;
        return next();
      }
    } catch (err) {
      // If it's not a valid JWT, try to check if it's a raw user API Key!
      const user = await dbAsync.get('SELECT * FROM users WHERE api_key = ?', [token]);
      if (user) {
        req.user = user;
        return next();
      }
    }
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in or provide a valid API Key/Token.' });
  }
  next();
}

app.use(resolveUser);

// -------------------------------------------------------------
// AUTHENTICATION ROUTE HANDLERS
// -------------------------------------------------------------
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    const existing = await dbAsync.get('SELECT * FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = generateRandomCode(12);

    // Auto-verify on registration for seamless demo/dev experience
    // The verification link is still printed to server console for reference
    await dbAsync.run(
      'INSERT INTO users (email, password, is_verified, verification_token, reset_token, reset_token_expires) VALUES (?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, true, verificationToken, null, null]
    );

    const baseUrl = getBaseUrl(req);
    const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
    // Log the verification link to console (for email simulation in dev/demo mode)
    await sendEmail({
      to: email,
      subject: 'Welcome to LinkSnip!',
      text: `Hello,\n\nWelcome to LinkSnip! Your account is now active.\n\nYou can also verify your email at:\n${verificationLink}\n\nThank you!`,
      html: `<p>Hello,</p><p>Welcome to LinkSnip! Your account is now active.</p><p>Verification link: <a href="${verificationLink}">${verificationLink}</a></p>`
    });

    return res.status(201).json({ message: 'Registration successful! You can now log in.' });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});


app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Verification token required.');
    }
    const user = await dbAsync.get('SELECT * FROM users WHERE verification_token = ?', [token]);
    if (!user) {
      return res.status(400).send('Invalid or expired verification token.');
    }
    await dbAsync.run('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id]);

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verified - LinkSnip</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
          h1 { color: #10b981; }
          a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ Email Verified Successfully!</h1>
          <p>Your LinkSnip account is verified. You can now log in.</p>
          <a href="/">Go to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).send('Internal server error.');
  }
});

app.get('/api/qr', async (req, res) => {
  try {
    const { url, dark, light } = req.query;
    if (!url) return res.status(400).send('url parameter is required');
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: {
        dark: dark || '#000000',
        light: light || '#ffffff'
      }
    });
    const img = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    return res.end(img);
  } catch (err) {
    console.error('QR generation error:', err);
    return res.status(500).send('Failed to generate QR code');
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await dbAsync.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    // Note: Email verification is auto-approved for demo/dev mode.
    // No verification gate needed.

    req.session.userId = user.id;
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, email: user.email, tier: user.tier || 'free', api_key: user.api_key }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (req.user) {
    return res.json({ 
      loggedIn: true, 
      user: { id: req.user.id, email: req.user.email, tier: req.user.tier || 'free', api_key: req.user.api_key } 
    });
  }
  return res.json({ loggedIn: false });
});

app.post('/api/auth/logout', async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    const user = await dbAsync.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.json({ message: 'If the email exists, a reset code has been sent.' });
    }
    const resetToken = generateRandomCode(8).toUpperCase();
    const resetExpires = new Date(Date.now() + 3600000).toISOString();

    await dbAsync.run(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, resetExpires, user.id]
    );

    await sendEmail({
      to: email,
      subject: 'LinkSnip Password Reset Code',
      text: `Hello,\n\nUse the following code to reset your password:\n\n${resetToken}\n\nThis code will expire in 1 hour.`,
      html: `<p>Hello,</p><p>Use the following code to reset your password:</p><h3>${resetToken}</h3><p>This code will expire in 1 hour.</p>`
    });

    return res.json({ message: 'If the email exists, a reset code has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Forgot password operation failed.' });
  }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }
    const user = await dbAsync.get('SELECT * FROM users WHERE reset_token = ?', [token]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }
    if (new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbAsync.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

    return res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Reset password failed.' });
  }
});

// Upgrade Plan Simulation
app.post('/api/auth/upgrade', requireAuth, async (req, res) => {
  try {
    await dbAsync.run("UPDATE users SET tier = 'pro' WHERE id = ?", [req.user.id]);
    return res.json({ message: 'Upgraded to Pro tier successfully!', tier: 'pro' });
  } catch (err) {
    console.error('Upgrade error:', err);
    return res.status(500).json({ error: 'Upgrade failed.' });
  }
});

// API Key Management Endpoints
app.post('/api/auth/api-key', requireAuth, async (req, res) => {
  try {
    const newApiKey = 'ls_' + generateRandomCode(24);
    await dbAsync.run('UPDATE users SET api_key = ? WHERE id = ?', [newApiKey, req.user.id]);
    return res.json({ api_key: newApiKey });
  } catch (err) {
    console.error('API key generation error:', err);
    return res.status(500).json({ error: 'Failed to generate API Key.' });
  }
});

app.delete('/api/auth/api-key', requireAuth, async (req, res) => {
  try {
    await dbAsync.run('UPDATE users SET api_key = ? WHERE id = ?', [null, req.user.id]);
    return res.json({ message: 'API key revoked.' });
  } catch (err) {
    console.error('API key revocation error:', err);
    return res.status(500).json({ error: 'Failed to revoke API Key.' });
  }
});

// -------------------------------------------------------------
// CACHE STATS ENDPOINT
// -------------------------------------------------------------
app.get('/api/cache/stats', async (req, res) => {
  return res.json(dbAsync.getCacheStats());
});

// -------------------------------------------------------------
// SHORTEN LINK ENDPOINT
// -------------------------------------------------------------
app.post('/api/shorten', apiLimiter, async (req, res) => {
  try {
    let { target_url, custom_alias, title, password, expire_at, max_clicks, tags, redirect_type } = req.body;
    const userId = req.user ? req.user.id : null;
    const userTier = req.user ? (req.user.tier || 'free') : 'free';

    if (!target_url) {
      return res.status(400).json({ error: 'Target URL is required.' });
    }

    target_url = normalizeUrl(target_url);

    try {
      new URL(target_url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format.' });
    }

    // AI Malicious URL Safety Check
    const safetyReport = analyzeUrlSafety(target_url);
    if (safetyReport.riskLevel === 'HIGH RISK') {
      return res.status(400).json({
        error: 'Shortening blocked: The destination URL was flagged as HIGH RISK by the Safe URL security scanner.',
        safety_report: safetyReport
      });
    }

    // Link Creation Tier limits: Free tier users can create a maximum of 15 active links
    if (userId && userTier === 'free') {
      const activeLinks = await dbAsync.all('SELECT * FROM links WHERE user_id = ? AND is_active = 1', [userId]);
      if (activeLinks.length >= 15) {
        return res.status(403).json({
          error: 'Free Tier Limit Reached: You have reached the limit of 15 active links. Upgrade to Pro for unlimited creation.'
        });
      }
    }

    let shortCode = '';

    if (custom_alias && custom_alias.trim()) {
      const aliasClean = custom_alias.trim();
      if (!isValidAlias(aliasClean)) {
        return res.status(400).json({ 
          error: 'Custom alias must be 3-30 characters long and contain only letters, numbers, hyphens, or underscores.' 
        });
      }

      const existing = await dbAsync.get(
        'SELECT id FROM links WHERE short_code = ? OR custom_alias = ?',
        [aliasClean, aliasClean]
      );
      if (existing) {
        return res.status(409).json({ error: 'Custom alias is already taken. Please try another.' });
      }
      shortCode = aliasClean;
    } else {
      let attempts = 0;
      while (attempts < 10) {
        const candidate = generateRandomCode(6);
        const existing = await dbAsync.get(
          'SELECT id FROM links WHERE short_code = ? OR custom_alias = ?',
          [candidate, candidate]
        );
        if (!existing) {
          shortCode = candidate;
          break;
        }
        attempts++;
      }
      if (!shortCode) {
        return res.status(500).json({ error: 'Failed to generate unique short code. Please try again.' });
      }
    }

    const rType = redirect_type ? parseInt(redirect_type, 10) : 302;

    const result = await dbAsync.run(
      `INSERT INTO links (short_code, target_url, custom_alias, title, password, expire_at, max_clicks, tags, redirect_type, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shortCode,
        target_url,
        custom_alias ? custom_alias.trim() : null,
        title || null,
        password || null,
        expire_at || null,
        max_clicks ? parseInt(max_clicks, 10) : null,
        tags || null,
        rType,
        userId
      ]
    );

    const baseUrl = getBaseUrl(req);
    const shortUrl = `${baseUrl}/${shortCode}`;
    const qrDataUrl = await QRCode.toDataURL(shortUrl, { width: 250, margin: 2 });

    return res.status(201).json({
      message: 'Link shortened successfully!',
      link: {
        id: result.lastID,
        short_code: shortCode,
        short_url: shortUrl,
        target_url,
        custom_alias: custom_alias || null,
        title: title || target_url,
        has_password: !!password,
        expire_at: expire_at || null,
        max_clicks: max_clicks || null,
        tags: tags || null,
        redirect_type: rType,
        qr_code: qrDataUrl,
        safety_report: safetyReport,
        created_at: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Error shortening URL:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Bulk Shortening Endpoint
app.post('/api/bulk-shorten', apiLimiter, async (req, res) => {
  try {
    let urls = [];
    const userId = req.user ? req.user.id : null;
    const userTier = req.user ? (req.user.tier || 'free') : 'free';

    if (req.body.csv) {
      const lines = req.body.csv.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',').map(p => p.trim());
        if (parts[0]) {
          urls.push({
            target_url: parts[0],
            custom_alias: parts[1] || null,
            title: parts[2] || null,
            tags: parts[3] || 'bulk-import'
          });
        }
      }
    } else if (req.body.urls && Array.isArray(req.body.urls)) {
      urls = req.body.urls;
    } else {
      return res.status(400).json({ error: 'Payload must contain a non-empty array of urls or a csv string.' });
    }

    // Free tier link checks
    if (userId && userTier === 'free') {
      const activeLinks = await dbAsync.all('SELECT * FROM links WHERE user_id = ? AND is_active = 1', [userId]);
      if (activeLinks.length + urls.length > 15) {
        return res.status(403).json({
          error: `Free Tier Limit Reached: Bulk import exceeds your limit of 15 links. Current active links: ${activeLinks.length}. Upgrade to Pro.`
        });
      }
    }

    const createdLinks = [];
    const baseUrl = getBaseUrl(req);

    for (const item of urls) {
      if (!item.target_url) continue;
      const target_url = normalizeUrl(item.target_url);

      const safetyReport = analyzeUrlSafety(target_url);
      if (safetyReport.riskLevel === 'HIGH RISK') {
        continue;
      }

      let shortCode = '';
      if (item.custom_alias && isValidAlias(item.custom_alias.trim())) {
        const aliasClean = item.custom_alias.trim();
        const existing = await dbAsync.get(
          'SELECT id FROM links WHERE short_code = ? OR custom_alias = ?',
          [aliasClean, aliasClean]
        );
        if (!existing) {
          shortCode = aliasClean;
        }
      }

      if (!shortCode) {
        shortCode = generateRandomCode(6);
      }

      // Default redirect 302, tags, userId
      const result = await dbAsync.run(
        `INSERT INTO links (short_code, target_url, custom_alias, title, tags, redirect_type, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [shortCode, target_url, item.custom_alias || null, item.title || target_url, item.tags || 'bulk-import', 302, userId]
      );

      createdLinks.push({
        id: result.lastID,
        short_code: shortCode,
        short_url: `${baseUrl}/${shortCode}`,
        target_url,
        title: item.title || target_url
      });
    }

    return res.status(201).json({
      message: `Successfully processed bulk shortening for ${createdLinks.length} links!`,
      count: createdLinks.length,
      links: createdLinks
    });
  } catch (err) {
    console.error('Error in bulk shorten:', err);
    return res.status(500).json({ error: 'Bulk shorten failed.' });
  }
});

// -------------------------------------------------------------
// AI SERVICES ENDPOINTS
// -------------------------------------------------------------
app.post('/api/ai/suggest-alias', (req, res) => {
  const { target_url, title } = req.body;
  if (!target_url) {
    return res.status(400).json({ error: 'target_url is required' });
  }
  const suggestions = suggestSmartAliases(target_url, title);
  return res.json({ suggestions });
});

app.post('/api/ai/analyze-safety', (req, res) => {
  const { target_url } = req.body;
  if (!target_url) {
    return res.status(400).json({ error: 'target_url is required' });
  }
  const report = analyzeUrlSafety(target_url);
  return res.json(report);
});

app.get('/api/ai/insights/:id', requireAuth, async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link || link.is_active === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    if (link.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    const clicks = await dbAsync.all('SELECT * FROM click_analytics WHERE link_id = ?', [linkId]);
    const totalClicks = clicks.length;

    const deviceCounts = {};
    const referrerCounts = {};
    const countryCounts = {};

    clicks.forEach(c => {
      deviceCounts[c.device] = (deviceCounts[c.device] || 0) + 1;
      referrerCounts[c.referrer] = (referrerCounts[c.referrer] || 0) + 1;
      countryCounts[c.geo_location] = (countryCounts[c.geo_location] || 0) + 1;
    });

    const topDevice = Object.keys(deviceCounts).sort((a,b) => deviceCounts[b] - deviceCounts[a])[0] || 'Desktop';
    const topReferrer = Object.keys(referrerCounts).sort((a,b) => referrerCounts[b] - referrerCounts[a])[0] || 'Direct';
    const topCountry = Object.keys(countryCounts).sort((a,b) => countryCounts[b] - countryCounts[a])[0] || 'Global';

    const insights = generateClickInsights({ totalClicks, topDevice, topReferrer, topCountry });
    return res.json(insights);
  } catch (err) {
    console.error('Error generating AI insights:', err);
    return res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// -------------------------------------------------------------
// LINK MANAGEMENT ENDPOINTS
// -------------------------------------------------------------
app.get('/api/links', requireAuth, async (req, res) => {
  try {
    const { search, tag, sort } = req.query;
    let query = 'SELECT * FROM links WHERE is_active = 1 AND user_id = ?';
    const params = [req.user.id];

    if (search) {
      query += ' AND (target_url LIKE ? OR short_code LIKE ? OR custom_alias LIKE ? OR title LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (tag) {
      query += ' AND tags LIKE ?';
      params.push(`%${tag}%`);
    }

    if (sort === 'clicks') {
      query += ' ORDER BY click_count DESC';
    } else if (sort === 'oldest') {
      query += ' ORDER BY created_at ASC';
    } else {
      query += ' ORDER BY created_at DESC';
    }

    const links = await dbAsync.all(query, params);
    const baseUrl = getBaseUrl(req);

    const formattedLinks = links.map(link => ({
      ...link,
      short_url: `${baseUrl}/${link.short_code}`,
      has_password: !!link.password
    }));

    return res.json({ links: formattedLinks });
  } catch (err) {
    console.error('Error fetching links:', err);
    return res.status(500).json({ error: 'Failed to fetch links.' });
  }
});

app.put('/api/links/:id', requireAuth, async (req, res) => {
  try {
    const linkId = req.params.id;
    const { target_url, title, expire_at, max_clicks, tags, is_enabled, redirect_type } = req.body;

    const existing = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!existing || existing.is_active === 0) {
      return res.status(404).json({ error: 'Link not found.' });
    }
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    let finalTarget = existing.target_url;
    if (target_url) {
      finalTarget = normalizeUrl(target_url);
    }

    const rType = redirect_type !== undefined ? parseInt(redirect_type, 10) : (existing.redirect_type || 302);

    await dbAsync.run(
      `UPDATE links 
       SET target_url = ?, title = ?, expire_at = ?, max_clicks = ?, tags = ?, is_enabled = ?, redirect_type = ?
       WHERE id = ?`,
      [
        finalTarget,
        title !== undefined ? title : existing.title,
        expire_at !== undefined ? expire_at : existing.expire_at,
        max_clicks !== undefined ? max_clicks : existing.max_clicks,
        tags !== undefined ? tags : existing.tags,
        is_enabled !== undefined ? (is_enabled ? 1 : 0) : (existing.is_enabled !== undefined ? existing.is_enabled : 1),
        rType,
        linkId
      ]
    );

    return res.json({ message: 'Link updated successfully.' });
  } catch (err) {
    console.error('Error updating link:', err);
    return res.status(500).json({ error: 'Failed to update link.' });
  }
});

app.delete('/api/links/:id', requireAuth, async (req, res) => {
  try {
    const linkId = req.params.id;
    const existing = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!existing || existing.is_active === 0) {
      return res.status(404).json({ error: 'Link not found.' });
    }
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    await dbAsync.run('UPDATE links SET is_active = 0 WHERE id = ?', [linkId]);
    return res.json({ message: 'Link archived successfully.' });
  } catch (err) {
    console.error('Error deleting/archiving link:', err);
    return res.status(500).json({ error: 'Failed to archive link.' });
  }
});

// Bulk Delete Endpoint
app.post('/api/links/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of link ids is required.' });
    }

    for (const linkId of ids) {
      const existing = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
      if (existing && existing.user_id === req.user.id) {
        await dbAsync.run('UPDATE links SET is_active = 0 WHERE id = ?', [linkId]);
      }
    }
    return res.json({ message: 'Selected links archived successfully.' });
  } catch (err) {
    console.error('Bulk delete error:', err);
    return res.status(500).json({ error: 'Failed to execute bulk deletion.' });
  }
});

// -------------------------------------------------------------
// ANALYTICS & EXPORT
// -------------------------------------------------------------
app.get('/api/analytics/:id', requireAuth, async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link || link.is_active === 0) {
      return res.status(404).json({ error: 'Link not found.' });
    }
    if (link.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    const clicks = await dbAsync.all(
      'SELECT * FROM click_analytics WHERE link_id = ? ORDER BY timestamp DESC',
      [linkId]
    );

    const clicksByDate = {};
    const referrerMap = {};
    const deviceMap = {};
    const countryMap = {};

    clicks.forEach(click => {
      const dateStr = click.timestamp.substring(0, 10);
      clicksByDate[dateStr] = (clicksByDate[dateStr] || 0) + 1;

      const ref = click.referrer || 'Direct / Organic';
      referrerMap[ref] = (referrerMap[ref] || 0) + 1;

      const dev = click.device || 'Desktop';
      deviceMap[dev] = (deviceMap[dev] || 0) + 1;

      const geo = click.geo_location || 'Unknown';
      countryMap[geo] = (countryMap[geo] || 0) + 1;
    });

    return res.json({
      link,
      total_clicks: clicks.length,
      clicks_over_time: clicksByDate,
      referrers: referrerMap,
      devices: deviceMap,
      countries: countryMap,
      recent_clicks: clicks.slice(0, 20)
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    return res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

app.get('/api/export/:id', requireAuth, async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link || link.is_active === 0) {
      return res.status(404).send('Link not found');
    }
    if (link.user_id !== req.user.id) {
      return res.status(403).send('Permission denied');
    }

    const clicks = await dbAsync.all(
      'SELECT * FROM click_analytics WHERE link_id = ? ORDER BY timestamp DESC',
      [linkId]
    );

    let csvContent = 'Click ID,Timestamp,IP Address,Geo Location,Referrer,Browser,OS,Device\n';
    clicks.forEach(c => {
      csvContent += `"${c.id}","${c.timestamp}","${c.ip}","${c.geo_location}","${c.referrer}","${c.browser}","${c.os}","${c.device}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="linksnip_analytics_${link.short_code}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    return res.status(500).send('Failed to export CSV');
  }
});

app.post('/api/verify-password', async (req, res) => {
  const { code, password } = req.body;
  if (!code || !password) {
    return res.status(400).json({ error: 'Code and password required.' });
  }

  const link = await dbAsync.get(
    'SELECT * FROM links WHERE (short_code = ? OR custom_alias = ?) AND is_active = 1',
    [code, code]
  );

  if (!link) {
    return res.status(404).json({ error: 'Link not found.' });
  }

  if (link.password === password) {
    return res.json({ success: true, target_url: link.target_url });
  } else {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
});

// -------------------------------------------------------------
// REDIRECTION SERVICE (CACHE-OPTIMIZED <10MS READ-THROUGH)
// -------------------------------------------------------------
app.get('/:code', async (req, res, next) => {
  const code = req.params.code;

  if (code.startsWith('api') || code.includes('.')) {
    return next();
  }

  try {
    // 1. Try Cache retrieval first
    let link = dbAsync.cacheGet(code);

    // 2. Cache miss -> Database query and set cache
    if (!link) {
      link = await dbAsync.get(
        'SELECT * FROM links WHERE (short_code = ? OR custom_alias = ?) AND is_active = 1',
        [code, code]
      );
      if (link) {
        dbAsync.cacheSet(code, link);
      }
    }

    if (!link) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Not Found - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
            h1 { color: #f43f5e; margin-bottom: 12px; }
            p { color: #94a3b8; font-size: 15px; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>404 - Link Not Found</h1>
            <p>The shortened link you requested does not exist, has been disabled, or is currently inactive.</p>
            <a href="/">Create New Link</a>
          </div>
        </body>
        </html>
      `);
    }

    // Check is_enabled
    if (link.is_enabled === 0 || link.is_enabled === false) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Disabled - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 420px; border: 1px solid #ef4444; }
            h1 { color: #ef4444; }
            p { color: #94a3b8; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>🔒 Link Disabled</h1>
            <p>This link has been temporarily disabled by its owner.</p>
            <a href="/">Go to LinkSnip</a>
          </div>
        </body>
        </html>
      `);
    }

    // Check Expiration Date
    if (link.expire_at && new Date(link.expire_at) < new Date()) {
      return res.status(410).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Expired - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; }
            h1 { color: #fbbf24; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⏰ Link Expired</h1>
            <p>This short link had an expiration date that has passed.</p>
            <a href="/">Create New Link</a>
          </div>
        </body>
        </html>
      `);
    }

    // Check Max Clicks Limit
    if (link.max_clicks && link.click_count >= link.max_clicks) {
      return res.status(410).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Click Limit Reached - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; }
            h1 { color: #fbbf24; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>🔒 Limit Reached</h1>
            <p>This link has reached its maximum allowed click limit (${link.max_clicks} clicks).</p>
            <a href="/">Create New Link</a>
          </div>
        </body>
        </html>
      `);
    }

    // Check Password Protection
    if (link.password) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>🔒 Protected Link - Password Required</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
            input { width: 80%; padding: 12px; margin: 16px 0; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; font-size: 16px; text-align: center; }
            button { background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; font-size: 16px; }
            button:hover { background: #4f46e5; }
            .error { color: #f43f5e; font-size: 14px; margin-top: 10px; display: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🔒 Protected Link</h2>
            <p>This link is secured with a password. Please enter it below to continue.</p>
            <input type="password" id="passInput" placeholder="Enter password" required />
            <br/>
            <button onclick="submitPass()">Unlock & Redirect</button>
            <div id="error" class="error">Incorrect password. Please try again.</div>
          </div>

          <script>
            async function submitPass() {
              const password = document.getElementById('passInput').value;
              const errorDiv = document.getElementById('error');
              errorDiv.style.display = 'none';

              try {
                const res = await fetch('/api/verify-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code: '${code}', password })
                });
                const data = await res.json();
                if (res.ok && data.target_url) {
                  window.location.href = data.target_url;
                } else {
                  errorDiv.style.display = 'block';
                }
              } catch (e) {
                errorDiv.style.display = 'block';
              }
            }
          </script>
        </body>
        </html>
      `);
    }

    // Ingest Click Event asynchronously via Non-Blocking Event Buffer Ingestion Queue
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const rawUserAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';

    const { browser, os, device } = parseUserAgent(rawUserAgent);
    const geo_location = deriveGeoLocation(ip);

    setImmediate(async () => {
      try {
        await dbAsync.pushClick({
          link_id: link.id,
          ip,
          geo_location,
          referrer,
          user_agent: rawUserAgent,
          browser,
          os,
          device
        });
      } catch (logErr) {
        console.error('Failed to buffer click asynchronously:', logErr);
      }
    });

    // Configurable Redirection (301 Permanent vs 302 Temporary)
    const redirectStatus = link.redirect_type === 301 ? 301 : 302;
    return res.redirect(redirectStatus, link.target_url);

  } catch (err) {
    console.error('Error handling redirect:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// Start Server
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(`🚀 LinkSnip URL Shortener running on ${HOST}:${PORT}`);
  console.log(`=================================================`);
});
