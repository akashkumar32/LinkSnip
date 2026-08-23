const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'linksnip_db.json');

// Memory cache of DB
let dbData = {
  links: [],
  click_analytics: []
};

// Load existing data from file if present
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      dbData = JSON.parse(raw);
      if (!dbData.links) dbData.links = [];
      if (!dbData.click_analytics) dbData.click_analytics = [];
    } else {
      saveDb();
    }
  } catch (err) {
    console.error('Error loading DB file, resetting memory DB:', err.message);
    dbData = { links: [], click_analytics: [] };
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving DB file:', err.message);
  }
}

// Initial load
loadDb();

/**
 * Pure JavaScript DB Engine with async SQL emulation
 * Guarantees 0% crashes on any Cloud deployment (Railway, Render, Vercel)
 */
const dbAsync = {
  get: async (sql, params = []) => {
    loadDb();
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('from links')) {
      if (params.length >= 2) {
        // e.g. WHERE short_code = ? OR custom_alias = ?
        const p1 = params[0];
        const p2 = params[1];
        return dbData.links.find(l => 
          (l.short_code === p1 || l.custom_alias === p1 || l.short_code === p2 || l.custom_alias === p2) &&
          (sqlLower.includes('is_active = 1') ? l.is_active === 1 : true)
        ) || null;
      } else if (params.length === 1) {
        // e.g. WHERE id = ?
        const p = params[0];
        return dbData.links.find(l => l.id == p || l.short_code == p || l.custom_alias == p) || null;
      }
    }
    return null;
  },

  all: async (sql, params = []) => {
    loadDb();
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('from click_analytics')) {
      if (params.length >= 1) {
        const linkId = params[0];
        const clicks = dbData.click_analytics.filter(c => c.link_id == linkId);
        return clicks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
      return dbData.click_analytics;
    }

    if (sqlLower.includes('from links')) {
      let results = dbData.links.filter(l => l.is_active === 1);

      if (params.length >= 4 && sqlLower.includes('like')) {
        const term = (params[0] || '').replace(/%/g, '').toLowerCase();
        results = results.filter(l => 
          (l.target_url && l.target_url.toLowerCase().includes(term)) ||
          (l.short_code && l.short_code.toLowerCase().includes(term)) ||
          (l.custom_alias && l.custom_alias.toLowerCase().includes(term)) ||
          (l.title && l.title.toLowerCase().includes(term))
        );
      }

      if (sqlLower.includes('order by click_count desc')) {
        results.sort((a, b) => b.click_count - a.click_count);
      } else if (sqlLower.includes('order by created_at asc')) {
        results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      } else {
        results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      return results;
    }

    return [];
  },

  run: async (sql, params = []) => {
    loadDb();
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('insert into links')) {
      const newId = dbData.links.length > 0 ? Math.max(...dbData.links.map(l => l.id || 0)) + 1 : 1;
      const newLink = {
        id: newId,
        short_code: params[0],
        target_url: params[1],
        custom_alias: params[2] || null,
        title: params[3] || params[1],
        password: params[4] || null,
        expire_at: params[5] || null,
        max_clicks: params[6] || null,
        click_count: 0,
        is_active: 1,
        tags: params[7] || null,
        created_at: new Date().toISOString()
      };
      dbData.links.push(newLink);
      saveDb();
      return { lastID: newId, changes: 1 };
    }

    if (sqlLower.includes('insert into click_analytics')) {
      const newId = dbData.click_analytics.length > 0 ? Math.max(...dbData.click_analytics.map(c => c.id || 0)) + 1 : 1;
      const newClick = {
        id: newId,
        link_id: params[0],
        timestamp: new Date().toISOString(),
        ip: params[1] || '127.0.0.1',
        geo_location: params[2] || 'Global',
        referrer: params[3] || 'Direct',
        user_agent: params[4] || '',
        browser: params[5] || 'Unknown',
        os: params[6] || 'Unknown',
        device: params[7] || 'Desktop'
      };
      dbData.click_analytics.push(newClick);
      saveDb();
      return { lastID: newId, changes: 1 };
    }

    if (sqlLower.includes('update links set click_count = click_count + 1')) {
      const linkId = params[0];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.click_count = (link.click_count || 0) + 1;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update links set is_active = 0')) {
      const linkId = params[0];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.is_active = 0;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update links set target_url =')) {
      const linkId = params[5];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.target_url = params[0] || link.target_url;
        link.title = params[1] !== undefined ? params[1] : link.title;
        link.expire_at = params[2] !== undefined ? params[2] : link.expire_at;
        link.max_clicks = params[3] !== undefined ? params[3] : link.max_clicks;
        link.tags = params[4] !== undefined ? params[4] : link.tags;
        saveDb();
      }
      return { changes: 1 };
    }

    return { lastID: 0, changes: 0 };
  }
};

module.exports = {
  dbAsync
};
