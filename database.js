const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'linksnip.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', DB_PATH);
  }
});

// Initialize tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      target_url TEXT NOT NULL,
      custom_alias TEXT UNIQUE,
      title TEXT,
      password TEXT,
      expire_at DATETIME,
      max_clicks INTEGER,
      click_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS click_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip TEXT,
      geo_location TEXT,
      referrer TEXT,
      user_agent TEXT,
      browser TEXT,
      os TEXT,
      device TEXT,
      FOREIGN KEY (link_id) REFERENCES links (id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_short_code ON links(short_code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_custom_alias ON links(custom_alias)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_link_analytics ON click_analytics(link_id)`);
});

/**
 * Promise helper wrappers for SQLite async queries
 */
const dbAsync = {
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

module.exports = {
  db,
  dbAsync
};
