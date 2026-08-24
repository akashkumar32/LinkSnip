const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'linksnip_db.json');

// Memory cache of DB
let dbData = {
  users: [],
  links: [],
  click_analytics: []
};

// In-Memory Redirection Cache
const linkCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

// Async Click Buffer Ingestion Queue
let clickBuffer = [];
const BUFFER_LIMIT = 5;
const FLUSH_INTERVAL = 5000; // Flush buffer every 5 seconds

// Load existing data from file if present
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // Always ensure all collections are properly initialized
      dbData.users = Array.isArray(parsed.users) ? parsed.users : [];
      dbData.links = Array.isArray(parsed.links) ? parsed.links : [];
      dbData.click_analytics = Array.isArray(parsed.click_analytics) ? parsed.click_analytics : [];
    } else {
      saveDb();
    }
  } catch (err) {
    console.error('Error loading DB file, resetting memory DB:', err.message);
    dbData = { users: [], links: [], click_analytics: [] };
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving DB file:', err.message);
  }
}

// Background click buffer flusher
function flushClicks() {
  if (clickBuffer.length === 0) return;
  loadDb();
  
  const nextId = dbData.click_analytics.length > 0 ? Math.max(...dbData.click_analytics.map(c => c.id || 0)) + 1 : 1;
  clickBuffer.forEach((c, idx) => {
    c.id = nextId + idx;
    dbData.click_analytics.push(c);
    
    // Increment link click count
    const link = dbData.links.find(l => l.id == c.link_id);
    if (link) {
      link.click_count = (link.click_count || 0) + 1;
      
      // Update cache
      linkCache.set(link.short_code, link);
      if (link.custom_alias) {
        linkCache.set(link.custom_alias, link);
      }
    }
  });

  clickBuffer = [];
  saveDb();
  console.log(`⚡ [Ingestion Queue] Batch flushed click analytics events to JSON Datastore.`);
}

setInterval(flushClicks, FLUSH_INTERVAL);

// Initial load
loadDb();

/**
 * Pure JavaScript DB Engine with async SQL emulation
 */
const dbAsync = {
  // In-Memory Redirection Cache Operations
  cacheGet: (code) => {
    if (linkCache.has(code)) {
      cacheHits++;
      console.log(`⚡ [Cache HIT] Code "${code}" retrieved from in-memory cache.`);
      return linkCache.get(code);
    }
    cacheMisses++;
    console.log(`⚡ [Cache MISS] Code "${code}" not found in cache. Accessing datastore.`);
    return null;
  },

  cacheSet: (code, link) => {
    linkCache.set(code, link);
  },

  getCacheStats: () => {
    const total = cacheHits + cacheMisses;
    const rate = total > 0 ? ((cacheHits / total) * 100).toFixed(1) : '0.0';
    return {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: `${rate}%`
    };
  },

  pushClick: async (clickData) => {
    const clickRecord = {
      link_id: clickData.link_id,
      timestamp: new Date().toISOString(),
      ip: clickData.ip || '127.0.0.1',
      geo_location: clickData.geo_location || 'Global',
      referrer: clickData.referrer || 'Direct',
      user_agent: clickData.user_agent || '',
      browser: clickData.browser || 'Unknown',
      os: clickData.os || 'Unknown',
      device: clickData.device || 'Desktop'
    };
    clickBuffer.push(clickRecord);
    if (clickBuffer.length >= BUFFER_LIMIT) {
      flushClicks();
    }
    return { success: true };
  },

  get: async (sql, params = []) => {
    loadDb();
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('from users')) {
      const p = params[0];
      if (sqlLower.includes('email =')) {
        return dbData.users.find(u => u.email === p) || null;
      }
      if (sqlLower.includes('id =')) {
        return dbData.users.find(u => u.id == p) || null;
      }
      if (sqlLower.includes('verification_token =')) {
        return dbData.users.find(u => u.verification_token === p) || null;
      }
      if (sqlLower.includes('reset_token =')) {
        return dbData.users.find(u => u.reset_token === p) || null;
      }
      if (sqlLower.includes('api_key =')) {
        return dbData.users.find(u => u.api_key === p) || null;
      }
    }

    if (sqlLower.includes('from links')) {
      if (params.length >= 2) {
        const p1 = params[0];
        const p2 = params[1];
        return dbData.links.find(l => 
          (l.short_code === p1 || l.custom_alias === p1 || l.short_code === p2 || l.custom_alias === p2) &&
          (sqlLower.includes('is_active = 1') ? l.is_active === 1 : true)
        ) || null;
      } else if (params.length === 1) {
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
      let results = dbData.links;

      if (sqlLower.includes('is_active = 1')) {
        results = results.filter(l => l.is_active === 1);
      } else if (sqlLower.includes('is_active = 0')) {
        results = results.filter(l => l.is_active === 0);
      }

      let paramIndex = 0;
      if (sqlLower.includes('user_id = ?') || sqlLower.includes('user_id =')) {
        const userIdVal = params[paramIndex++];
        results = results.filter(l => l.user_id == userIdVal);
      }

      if (sqlLower.includes('like')) {
        const term = (params[paramIndex++] || '').replace(/%/g, '').toLowerCase();
        results = results.filter(l => 
          (l.target_url && l.target_url.toLowerCase().includes(term)) ||
          (l.short_code && l.short_code.toLowerCase().includes(term)) ||
          (l.custom_alias && l.custom_alias.toLowerCase().includes(term)) ||
          (l.title && l.title.toLowerCase().includes(term))
        );
      }

      if (sqlLower.includes('tags like')) {
        const tagTerm = (params[paramIndex++] || '').replace(/%/g, '').toLowerCase();
        results = results.filter(l => 
          l.tags && l.tags.toLowerCase().includes(tagTerm)
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

    if (sqlLower.includes('insert into users')) {
      const newId = dbData.users.length > 0 ? Math.max(...dbData.users.map(u => u.id || 0)) + 1 : 1;
      const newUser = {
        id: newId,
        email: params[0],
        password: params[1],
        is_verified: params[2] || false,
        verification_token: params[3] || null,
        reset_token: params[4] || null,
        reset_token_expires: params[5] || null,
        tier: 'free',
        api_key: null,
        created_at: new Date().toISOString()
      };
      dbData.users.push(newUser);
      saveDb();
      return { lastID: newId, changes: 1 };
    }

    if (sqlLower.includes('update users set is_verified = 1')) {
      const userId = params[0];
      const user = dbData.users.find(u => u.id == userId);
      if (user) {
        user.is_verified = true;
        user.verification_token = null;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update users set reset_token =')) {
      const token = params[0];
      const expires = params[1];
      const userId = params[2];
      const user = dbData.users.find(u => u.id == userId);
      if (user) {
        user.reset_token = token;
        user.reset_token_expires = expires;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update users set password =')) {
      const newPassword = params[0];
      const userId = params[1];
      const user = dbData.users.find(u => u.id == userId);
      if (user) {
        user.password = newPassword;
        user.reset_token = null;
        user.reset_token_expires = null;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update users set api_key =')) {
      const apiKey = params[0];
      const userId = params[1];
      const user = dbData.users.find(u => u.id == userId);
      if (user) {
        user.api_key = apiKey;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update users set tier =')) {
      const tier = params[0];
      const userId = params[1];
      const user = dbData.users.find(u => u.id == userId);
      if (user) {
        user.tier = tier;
        saveDb();
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('insert into links')) {
      const newId = dbData.links.length > 0 ? Math.max(...dbData.links.map(l => l.id || 0)) + 1 : 1;
      
      let newLink;
      if (sqlLower.includes('user_id') && params.length === 10) {
        // Includes redirect_type (params[8]) and user_id (params[9])
        newLink = {
          id: newId,
          short_code: params[0],
          target_url: params[1],
          custom_alias: params[2] || null,
          title: params[3] || params[1],
          password: params[4] || null,
          expire_at: params[5] || null,
          max_clicks: params[6] || null,
          tags: params[7] || null,
          redirect_type: parseInt(params[8] || '302', 10),
          user_id: params[9] || null,
          click_count: 0,
          is_active: 1,
          is_enabled: 1,
          created_at: new Date().toISOString()
        };
      } else if (sqlLower.includes('user_id') && params.length === 9) {
        newLink = {
          id: newId,
          short_code: params[0],
          target_url: params[1],
          custom_alias: params[2] || null,
          title: params[3] || params[1],
          password: params[4] || null,
          expire_at: params[5] || null,
          max_clicks: params[6] || null,
          tags: params[7] || null,
          redirect_type: 302,
          user_id: params[8] || null,
          click_count: 0,
          is_active: 1,
          is_enabled: 1,
          created_at: new Date().toISOString()
        };
      } else {
        newLink = {
          id: newId,
          short_code: params[0],
          target_url: params[1],
          custom_alias: params[2] || null,
          title: params[3] || params[1],
          password: params[4] || null,
          expire_at: params[5] || null,
          max_clicks: params[6] || null,
          tags: params[7] || null,
          redirect_type: 302,
          user_id: null,
          click_count: 0,
          is_active: 1,
          is_enabled: 1,
          created_at: new Date().toISOString()
        };
      }
      
      dbData.links.push(newLink);
      saveDb();
      return { lastID: newId, changes: 1 };
    }

    if (sqlLower.includes('update links set click_count = click_count + 1')) {
      const linkId = params[0];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.click_count = (link.click_count || 0) + 1;
        saveDb();
        linkCache.set(link.short_code, link);
        if (link.custom_alias) linkCache.set(link.custom_alias, link);
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update links set is_active = 0')) {
      const linkId = params[0];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.is_active = 0;
        saveDb();
        linkCache.delete(link.short_code);
        if (link.custom_alias) linkCache.delete(link.custom_alias);
      }
      return { changes: 1 };
    }

    if (sqlLower.includes('update links set target_url =')) {
      const linkId = params[params.length - 1];
      const link = dbData.links.find(l => l.id == linkId);
      if (link) {
        link.target_url = params[0] || link.target_url;
        link.title = params[1] !== undefined ? params[1] : link.title;
        link.expire_at = params[2] !== undefined ? params[2] : link.expire_at;
        link.max_clicks = params[3] !== undefined ? params[3] : link.max_clicks;
        link.tags = params[4] !== undefined ? params[4] : link.tags;
        if (params.length >= 7) {
          link.is_enabled = params[5] !== undefined ? params[5] : link.is_enabled;
        }
        if (params.length >= 8) {
          link.redirect_type = params[6] !== undefined ? parseInt(params[6], 10) : link.redirect_type;
        }
        saveDb();
        
        // Update/invalidate cache
        linkCache.delete(link.short_code);
        if (link.custom_alias) linkCache.delete(link.custom_alias);
      }
      return { changes: 1 };
    }

    return { lastID: 0, changes: 0 };
  }
};

module.exports = {
  dbAsync
};
