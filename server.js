const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db, init, getMonday, parseDDMMYYYY, formatDDMMYYYY } = require('./db');

init();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'production-app-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login.html?error=session');
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}

function requireProductionManager(req, res, next) {
  if (req.session.user && req.session.user.role === 'production_manager') return next();
  res.status(403).json({ error: 'Production manager only' });
}

function getVariantsForUser(userId, role) {
  const all = db.prepare('SELECT id, name FROM variants ORDER BY display_order, name').all();
  if (role === 'admin') return all;
  const allowed = db.prepare('SELECT variant_id FROM manager_variant_access WHERE user_id = ?').all(userId);
  if (allowed.length === 0) return all;
  const ids = new Set(allowed.map(a => a.variant_id));
  return all.filter(v => ids.has(v.id));
}

// ---------- Pages ----------
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  if (req.session.user.role === 'admin') return res.redirect('/admin.html');
  res.redirect('/manager.html');
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.redirect('/login.html?error=missing');
  const user = db.prepare('SELECT id, username, password_hash, role, first_name, last_name FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.redirect('/login.html?error=invalid');
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
  };
  if (user.role === 'admin') return res.redirect('/admin.html');
  res.redirect('/manager.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// ---------- API: shared ----------
app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

app.get('/api/variants', requireAuth, (req, res) => {
  const variants = getVariantsForUser(req.session.user.id, req.session.user.role);
  res.json(variants);
});

// ---------- API: admin variants CRUD ----------
app.get('/api/admin/variants', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, name, display_order FROM variants ORDER BY display_order, name').all();
  res.json(rows);
});

app.post('/api/admin/variants', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM variants').get();
  try {
    db.prepare('INSERT INTO variants (name, display_order) VALUES (?, ?)').run(String(name).trim(), maxOrder.n);
    const row = db.prepare('SELECT id, name, display_order FROM variants WHERE id = last_insert_rowid()').get();
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'Variant name already exists' });
    throw e;
  }
});

app.patch('/api/admin/variants/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, display_order } = req.body || {};
  const row = db.prepare('SELECT id FROM variants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Variant not found' });
  if (name !== undefined) db.prepare('UPDATE variants SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (display_order !== undefined) db.prepare('UPDATE variants SET display_order = ? WHERE id = ?').run(Number(display_order), id);
  const out = db.prepare('SELECT id, name, display_order FROM variants WHERE id = ?').get(id);
  res.json(out);
});

app.delete('/api/admin/variants/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('DELETE FROM variants WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'Variant not found' });
  db.prepare('DELETE FROM manager_variant_access WHERE variant_id = ?').run(id);
  res.json({ deleted: true });
});

// ---------- API: manager variant access (admin) ----------
app.get('/api/admin/manager-variant-access/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const rows = db.prepare('SELECT variant_id FROM manager_variant_access WHERE user_id = ?').all(userId);
  res.json(rows.map(r => r.variant_id));
});

app.put('/api/admin/manager-variant-access/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const variantIds = Array.isArray(req.body) ? req.body : (req.body.variant_ids || []);
  db.prepare('DELETE FROM manager_variant_access WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO manager_variant_access (user_id, variant_id) VALUES (?, ?)');
  for (const vid of variantIds) ins.run(userId, Number(vid));
  res.json({ variant_ids: variantIds.map(Number) });
});

// ---------- API: production manager ----------
app.post('/api/weekly-targets', requireAuth, requireProductionManager, (req, res) => {
  const { week_start_date, variant_id, target_units } = req.body || {};
  const dateStr = week_start_date ? (parseDDMMYYYY(week_start_date) || week_start_date) : null;
  const weekStart = dateStr ? getMonday(dateStr) : getMonday(new Date());
  const thisMonday = getMonday(new Date());
  if (weekStart < thisMonday) {
    return res.status(400).json({ error: 'Targets can only be set for the current week or future weeks (from Monday).' });
  }
  const variantId = Number(variant_id);
  const units = Number(target_units);
  if (!variantId || Number.isNaN(units)) return res.status(400).json({ error: 'Variant and target units required' });
  const variants = getVariantsForUser(req.session.user.id, 'production_manager');
  if (!variants.some(v => v.id === variantId)) return res.status(403).json({ error: 'Variant not allowed' });
  try {
    db.prepare(
      'INSERT INTO weekly_targets (user_id, week_start_date, variant_id, target_units) VALUES (?, ?, ?, ?)'
    ).run(req.session.user.id, weekStart, variantId, units);
    const row = db.prepare('SELECT * FROM weekly_targets WHERE id = last_insert_rowid()').get();
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'Target already set for this variant and week' });
    throw e;
  }
});

app.get('/api/weekly-targets', requireAuth, (req, res) => {
  const userId = req.session.user.role === 'admin' && req.query.user_id ? req.query.user_id : req.session.user.id;
  const rows = db.prepare(`
    SELECT w.*, v.name AS variant_name FROM weekly_targets w
    JOIN variants v ON v.id = w.variant_id
    WHERE w.user_id = ? ORDER BY w.week_start_date DESC, v.name
  `).all(userId);
  res.json(rows);
});

app.post('/api/daily-production', requireAuth, requireProductionManager, (req, res) => {
  const { production_date, variant_id, units, hours, note } = req.body || {};
  const dateStr = production_date ? (parseDDMMYYYY(production_date) || production_date) : null;
  const date = (dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const variantId = Number(variant_id);
  const unitsNum = Number(units);
  if (!variantId || Number.isNaN(unitsNum)) return res.status(400).json({ error: 'Variant and units required' });
  const noteStr = note != null ? String(note).trim().slice(0, 250) : null;
  const hoursNum = hours != null && hours !== '' ? Number(hours) : null;
  const variants = getVariantsForUser(req.session.user.id, 'production_manager');
  if (!variants.some(v => v.id === variantId)) return res.status(403).json({ error: 'Variant not allowed' });
  db.prepare(
    'INSERT INTO daily_production (user_id, production_date, variant_id, units, hours, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.session.user.id, date, variantId, unitsNum, Number.isNaN(hoursNum) ? null : hoursNum, noteStr);
  const row = db.prepare('SELECT * FROM daily_production WHERE id = last_insert_rowid()').get();
  res.status(201).json(row);
});

app.get('/api/daily-production', requireAuth, (req, res) => {
  const userId = req.session.user.role === 'admin' && req.query.user_id ? req.query.user_id : req.session.user.id;
  const rows = db.prepare(`
    SELECT d.*, v.name AS variant_name FROM daily_production d
    JOIN variants v ON v.id = d.variant_id
    WHERE d.user_id = ? ORDER BY d.production_date DESC, d.created_at DESC
  `).all(userId);
  res.json(rows);
});

app.get('/api/target-vs-production', requireAuth, requireProductionManager, (req, res) => {
  const userId = req.session.user.id;
  const targets = db.prepare(`
    SELECT w.*, v.name AS variant_name FROM weekly_targets w
    JOIN variants v ON v.id = w.variant_id
    WHERE w.user_id = ? ORDER BY w.week_start_date DESC, v.name
  `).all(userId);
  const productions = db.prepare('SELECT * FROM daily_production WHERE user_id = ?').all(userId);
  const byWeekVariant = {};
  for (const t of targets) {
    const key = `${t.week_start_date}|${t.variant_id}`;
    byWeekVariant[key] = {
      week_start_date: t.week_start_date,
      variant_id: t.variant_id,
      variant_name: t.variant_name,
      target: t.target_units,
      produced: 0,
    };
  }
  for (const p of productions) {
    const week = getMonday(p.production_date);
    const key = `${week}|${p.variant_id}`;
    if (byWeekVariant[key]) byWeekVariant[key].produced += p.units;
  }
  const list = Object.values(byWeekVariant).map(row => ({
    ...row,
    pct: row.target > 0 ? Math.round((row.produced / row.target) * 100) : (row.produced === 0 ? 0 : 100),
  })).sort((a, b) => b.week_start_date.localeCompare(a.week_start_date) || a.variant_name.localeCompare(b.variant_name));
  res.json(list);
});

app.delete('/api/weekly-targets/most-recent', requireAuth, requireProductionManager, (req, res) => {
  const row = db.prepare('SELECT id FROM weekly_targets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.user.id);
  if (!row) return res.status(404).json({ error: 'No weekly target to delete' });
  db.prepare('DELETE FROM weekly_targets WHERE id = ?').run(row.id);
  res.json({ deleted: true });
});

app.delete('/api/daily-production/most-recent', requireAuth, requireProductionManager, (req, res) => {
  const row = db.prepare('SELECT id FROM daily_production WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.user.id);
  if (!row) return res.status(404).json({ error: 'No daily production to delete' });
  db.prepare('DELETE FROM daily_production WHERE id = ?').run(row.id);
  res.json({ deleted: true });
});

// ---------- API: admin summary (manager target vs production) ----------
app.get('/api/admin/summary/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const targets = db.prepare(`
    SELECT w.*, v.name AS variant_name FROM weekly_targets w
    JOIN variants v ON v.id = w.variant_id
    WHERE w.user_id = ? ORDER BY w.week_start_date, v.name
  `).all(userId);
  const productions = db.prepare('SELECT * FROM daily_production WHERE user_id = ?').all(userId);
  const byWeekVariant = {};
  for (const t of targets) {
    const key = `${t.week_start_date}|${t.variant_id}`;
    byWeekVariant[key] = {
      week_start_date: t.week_start_date,
      variant_id: t.variant_id,
      variant_name: t.variant_name,
      target: t.target_units,
      produced: 0,
    };
  }
  for (const p of productions) {
    const week = getMonday(p.production_date);
    const key = `${week}|${p.variant_id}`;
    if (byWeekVariant[key]) byWeekVariant[key].produced += p.units;
  }
  const list = Object.values(byWeekVariant).map(row => ({
    ...row,
    pct: row.target > 0 ? Math.round((row.produced / row.target) * 100) : (row.produced === 0 ? 0 : 100),
  })).sort((a, b) => a.week_start_date.localeCompare(b.week_start_date) || a.variant_name.localeCompare(b.variant_name));
  res.json(list);
});

// ---------- API: admin users ----------
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, role, first_name, last_name, note, created_at FROM users ORDER BY username').all();
  res.json(rows);
});

app.get('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id, username, role, first_name, last_name, note FROM users WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json(row);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, first_name, last_name } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Username, password and role required' });
  if (!['admin', 'production_manager'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(
      'INSERT INTO users (username, password_hash, role, first_name, last_name) VALUES (?, ?, ?, ?, ?)'
    ).run(username.trim(), hash, role, (first_name || '').trim(), (last_name || '').trim());
    const row = db.prepare('SELECT id, username, role, first_name, last_name, created_at FROM users WHERE username = ?').get(username.trim());
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'Username already exists' });
    throw e;
  }
});

app.patch('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { first_name, last_name, note, password } = req.body || {};
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (first_name !== undefined) db.prepare('UPDATE users SET first_name = ? WHERE id = ?').run((first_name || '').trim(), id);
  if (last_name !== undefined) db.prepare('UPDATE users SET last_name = ? WHERE id = ?').run((last_name || '').trim(), id);
  if (note !== undefined) db.prepare('UPDATE users SET note = ? WHERE id = ?').run(note == null ? null : String(note).trim(), id);
  if (password && password.length > 0) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  const row = db.prepare('SELECT id, username, role, first_name, last_name, note, created_at FROM users WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM manager_variant_access WHERE user_id = ?').run(id);
  res.json({ deleted: true });
});

function escapeCsv(s) {
  const t = String(s == null ? '' : s);
  if (/[",\n\r]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

app.get('/api/export/targets', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.first_name, u.last_name, w.week_start_date, v.name AS variant_name, w.target_units, w.created_at
    FROM weekly_targets w
    JOIN users u ON u.id = w.user_id
    JOIN variants v ON v.id = w.variant_id
    ORDER BY u.username, w.week_start_date, v.name
  `).all();
  const header = 'username,first_name,last_name,week_start_date,variant,target_units,created_at';
  const lines = [header, ...rows.map(r => [r.username, r.first_name, r.last_name, r.week_start_date, r.variant_name, r.target_units, r.created_at].map(escapeCsv).join(','))];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=weekly_targets.csv');
  res.send(lines.join('\n'));
});

app.get('/api/export/daily', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.first_name, u.last_name, d.production_date, v.name AS variant_name, d.units, d.hours, d.note, d.created_at
    FROM daily_production d
    JOIN users u ON u.id = d.user_id
    JOIN variants v ON v.id = d.variant_id
    ORDER BY u.username, d.production_date, d.created_at
  `).all();
  const header = 'username,first_name,last_name,production_date,variant,units,hours,note,created_at';
  const lines = [header, ...rows.map(r => [r.username, r.first_name, r.last_name, r.production_date, r.variant_name, r.units, r.hours, r.note, r.created_at].map(escapeCsv).join(','))];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=daily_production.csv');
  res.send(lines.join('\n'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
