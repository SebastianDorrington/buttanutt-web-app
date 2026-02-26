const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

const DEFAULT_VARIANTS = [
  '1L milk',
  '1L coconut water',
  '1kg nut butter',
  '2.5L nut butter',
  '250g nut butter',
  'Luxury nuts',
  '1kg roasted nuts',
  '1kg oats',
  '32g squeeze packs',
  '1kg Peanut butter',
  '2.5L peanut butter',
  '250g peanut butter',
  '500g cultured product',
];

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'production_manager')),
      first_name TEXT,
      last_name TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS manager_variant_access (
      user_id INTEGER NOT NULL REFERENCES users(id),
      variant_id INTEGER NOT NULL REFERENCES variants(id),
      PRIMARY KEY (user_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS weekly_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      week_start_date TEXT NOT NULL,
      variant_id INTEGER NOT NULL REFERENCES variants(id),
      target_units REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, week_start_date, variant_id)
    );

    CREATE TABLE IF NOT EXISTS daily_production (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      production_date TEXT NOT NULL,
      variant_id INTEGER NOT NULL REFERENCES variants(id),
      units REAL NOT NULL,
      hours REAL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wt_user_week ON weekly_targets(user_id, week_start_date);
    CREATE INDEX IF NOT EXISTS idx_dp_user_date ON daily_production(user_id, production_date);
  `);

  const cols = db.prepare("PRAGMA table_info(weekly_targets)").all();
  const hasVariantId = cols && cols.some(c => c.name === 'variant_id');
  if (cols.length > 0 && !hasVariantId) {
    db.exec('DROP TABLE IF EXISTS weekly_targets; DROP TABLE IF EXISTS daily_production;');
    db.exec(`
      CREATE TABLE weekly_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        week_start_date TEXT NOT NULL,
        variant_id INTEGER NOT NULL REFERENCES variants(id),
        target_units REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, week_start_date, variant_id)
      );
      CREATE TABLE daily_production (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        production_date TEXT NOT NULL,
        variant_id INTEGER NOT NULL REFERENCES variants(id),
        units REAL NOT NULL,
        hours REAL,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_wt_user_week ON weekly_targets(user_id, week_start_date);
      CREATE INDEX idx_dp_user_date ON daily_production(user_id, production_date);
    `);
  }

  const variantCount = db.prepare('SELECT COUNT(*) AS n FROM variants').get();
  if (variantCount.n === 0) {
    const ins = db.prepare('INSERT INTO variants (name, display_order) VALUES (?, ?)');
    DEFAULT_VARIANTS.forEach((name, i) => ins.run(name, i));
  }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (userCount.n === 0) {
    const hash = bcrypt.hashSync('123', 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, role, first_name, last_name) VALUES (?, ?, 'admin', 'Admin', '')"
    ).run('admin', hash);
    db.prepare(
      "INSERT INTO users (username, password_hash, role, first_name, last_name) VALUES (?, ?, 'production_manager', 'John', 'Doe')"
    ).run('johndoe', hash);
  }
}

function getMonday(d) {
  const date = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

function parseDDMMYYYY(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function formatDDMMYYYY(isoDate) {
  if (!isoDate || isoDate.length < 10) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

module.exports = {
  db,
  init,
  getMonday,
  parseDDMMYYYY,
  formatDDMMYYYY,
};
