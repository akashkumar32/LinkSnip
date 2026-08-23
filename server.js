const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { dbAsync } = require('./database');
const { encodeBase62, generateRandomCode, isValidAlias } = require('./utils/base62');
const { parseUserAgent, deriveGeoLocation } = require('./utils/geoDeviceParser');
const { suggestSmartAliases, analyzeUrlSafety, generateClickInsights } = require('./utils/aiEngine');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
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

// -------------------------------------------------------------
// 1. SHORTEN LINK ENDPOINT
// -------------------------------------------------------------
app.post('/api/shorten', async (req, res) => {
  try {
    let { target_url, custom_alias, title, password, expire_at, max_clicks, tags } = req.body;

    if (!target_url) {
      return res.status(400).json({ error: 'Target URL is required.' });
    }

    target_url = normalizeUrl(target_url);

    try {
      new URL(target_url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format.' });
    }

    let shortCode = '';

    if (custom_alias && custom_alias.trim()) {
      const aliasClean = custom_alias.trim();
      if (!isValidAlias(aliasClean)) {
        return res.status(400).json({ 
          error: 'Custom alias must be 3-30 characters long and contain only letters, numbers, hyphens, or underscores.' 
        });
      }

      // Check uniqueness against short_code AND custom_alias
      const existing = await dbAsync.get(
        'SELECT id FROM links WHERE short_code = ? OR custom_alias = ?',
        [aliasClean, aliasClean]
      );
      if (existing) {
        return res.status(409).json({ error: 'Custom alias is already taken. Please try another.' });
      }
      shortCode = aliasClean;
    } else {
      // Generate random Base62 short code
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

    // Run AI Safety Check on creation
    const safetyReport = analyzeUrlSafety(target_url);

    // Insert into DB
    const result = await dbAsync.run(
      `INSERT INTO links (short_code, target_url, custom_alias, title, password, expire_at, max_clicks, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shortCode,
        target_url,
        custom_alias ? custom_alias.trim() : null,
        title || null,
        password || null,
        expire_at || null,
        max_clicks ? parseInt(max_clicks, 10) : null,
        tags || null
      ]
    );

    const protocol = req.protocol;
    const host = req.get('host');
    const shortUrl = `${protocol}://${host}/${shortCode}`;
    const qrDataUrl = await QRCode.toDataURL(shortUrl);

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

// Bulk URL Shortening Endpoint (Accepts array of URLs or CSV lines)
app.post('/api/bulk-shorten', async (req, res) => {
  try {
    const { urls } = req.body; // Array of { target_url, title, custom_alias, tags }
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Payload must contain a non-empty array of urls.' });
    }

    const createdLinks = [];
    const protocol = req.protocol;
    const host = req.get('host');

    for (const item of urls) {
      if (!item.target_url) continue;
      const target_url = normalizeUrl(item.target_url);
      let shortCode = generateRandomCode(6);

      const result = await dbAsync.run(
        `INSERT INTO links (short_code, target_url, custom_alias, title, tags) VALUES (?, ?, ?, ?, ?)`,
        [shortCode, target_url, item.custom_alias || null, item.title || target_url, item.tags || 'bulk-import']
      );

      createdLinks.push({
        id: result.lastID,
        short_code: shortCode,
        short_url: `${protocol}://${host}/${shortCode}`,
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
// 2. AI SERVICES ENDPOINTS
// -------------------------------------------------------------

// Suggest AI Smart Aliases
app.post('/api/ai/suggest-alias', (req, res) => {
  const { target_url, title } = req.body;
  if (!target_url) {
    return res.status(400).json({ error: 'target_url is required' });
  }
  const suggestions = suggestSmartAliases(target_url, title);
  return res.json({ suggestions });
});

// Analyze URL Safety
app.post('/api/ai/analyze-safety', (req, res) => {
  const { target_url } = req.body;
  if (!target_url) {
    return res.status(400).json({ error: 'target_url is required' });
  }
  const report = analyzeUrlSafety(target_url);
  return res.json(report);
});

// Get AI Insights for a Link
app.get('/api/ai/insights/:id', async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const clicks = await dbAsync.all('SELECT * FROM click_analytics WHERE link_id = ?', [linkId]);
    
    // Calculate aggregate metrics
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
// 3. LINK MANAGEMENT & LISTING ENDPOINTS
// -------------------------------------------------------------

// List All User Links
app.get('/api/links', async (req, res) => {
  try {
    const { search, tag, sort } = req.query;
    let query = 'SELECT * FROM links WHERE is_active = 1';
    const params = [];

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
    const host = req.get('host');
    const protocol = req.protocol;

    const formattedLinks = links.map(link => ({
      ...link,
      short_url: `${protocol}://${host}/${link.short_code}`,
      has_password: !!link.password
    }));

    return res.json({ links: formattedLinks });
  } catch (err) {
    console.error('Error fetching links:', err);
    return res.status(500).json({ error: 'Failed to fetch links.' });
  }
});

// Update Link
app.put('/api/links/:id', async (req, res) => {
  try {
    const linkId = req.params.id;
    const { target_url, title, expire_at, max_clicks, tags } = req.body;

    const existing = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!existing) {
      return res.status(404).json({ error: 'Link not found.' });
    }

    let finalTarget = existing.target_url;
    if (target_url) {
      finalTarget = normalizeUrl(target_url);
    }

    await dbAsync.run(
      `UPDATE links 
       SET target_url = ?, title = ?, expire_at = ?, max_clicks = ?, tags = ?
       WHERE id = ?`,
      [
        finalTarget,
        title !== undefined ? title : existing.title,
        expire_at !== undefined ? expire_at : existing.expire_at,
        max_clicks !== undefined ? max_clicks : existing.max_clicks,
        tags !== undefined ? tags : existing.tags,
        linkId
      ]
    );

    return res.json({ message: 'Link updated successfully.' });
  } catch (err) {
    console.error('Error updating link:', err);
    return res.status(500).json({ error: 'Failed to update link.' });
  }
});

// Delete/Archive Link
app.delete('/api/links/:id', async (req, res) => {
  try {
    const linkId = req.params.id;
    await dbAsync.run('UPDATE links SET is_active = 0 WHERE id = ?', [linkId]);
    return res.json({ message: 'Link archived successfully.' });
  } catch (err) {
    console.error('Error deleting link:', err);
    return res.status(500).json({ error: 'Failed to delete link.' });
  }
});

// -------------------------------------------------------------
// 4. ANALYTICS & EXPORT ENDPOINTS
// -------------------------------------------------------------

// Get Link Detailed Analytics
app.get('/api/analytics/:id', async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link) {
      return res.status(404).json({ error: 'Link not found.' });
    }

    const clicks = await dbAsync.all(
      'SELECT * FROM click_analytics WHERE link_id = ? ORDER BY timestamp DESC',
      [linkId]
    );

    // Clicks over time (grouped by date)
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
      total_clicks: link.click_count,
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

// Export CSV Endpoint
app.get('/api/export/:id', async (req, res) => {
  try {
    const linkId = req.params.id;
    const link = await dbAsync.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link) {
      return res.status(404).send('Link not found');
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

// Verify Password for Protected Link
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
// 5. REDIRECTION SERVICE (FAST LOOKUP <50MS)
// -------------------------------------------------------------
app.get('/:code', async (req, res, next) => {
  const code = req.params.code;

  // Exclude static asset requests or api routes
  if (code.startsWith('api') || code.includes('.')) {
    return next();
  }

  try {
    const link = await dbAsync.get(
      'SELECT * FROM links WHERE (short_code = ? OR custom_alias = ?) AND is_active = 1',
      [code, code]
    );

    if (!link) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Not Found - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h1 { color: #f43f5e; margin-bottom: 12px; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>404 - Link Not Found</h1>
            <p>The shortened link you requested does not exist or has been disabled.</p>
            <a href="/">Go to LinkSnip Home</a>
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
          <title>Password Protected Link - LinkSnip</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            input { width: 80%; padding: 12px; margin: 16px 0; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; font-size: 16px; }
            button { background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; font-size: 16px; }
            button:hover { background: #4f46e5; }
            .error { color: #f43f5e; font-size: 14px; margin-top: 10px; display: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🔒 Protected Link</h2>
            <p>Please enter the password to access this URL.</p>
            <input type="password" id="passInput" placeholder="Enter password..." />
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

    // Async Click Logging (non-blocking for low latency redirect)
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const rawUserAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';

    const { browser, os, device } = parseUserAgent(rawUserAgent);
    const geo_location = deriveGeoLocation(ip);

    setImmediate(async () => {
      try {
        await dbAsync.run(
          `INSERT INTO click_analytics (link_id, ip, geo_location, referrer, user_agent, browser, os, device)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [link.id, ip, geo_location, referrer, rawUserAgent, browser, os, device]
        );
        await dbAsync.run('UPDATE links SET click_count = click_count + 1 WHERE id = ?', [link.id]);
      } catch (logErr) {
        console.error('Failed to log click asynchronously:', logErr);
      }
    });

    // Instant 302 Redirect
    return res.redirect(302, link.target_url);

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

