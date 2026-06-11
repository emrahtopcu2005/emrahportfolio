const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const https = require('https');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new PgSession({ pool }),
  secret: process.env.SESSION_SECRET || 'gizli-anahtar-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/');
}

async function getStockPrice(ticker) {
  return new Promise((resolve) => {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price && price > 0) resolve(price);
          else resolve(null);
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function updateAllPrices() {
  try {
    const result = await pool.query('SELECT DISTINCT ticker FROM positions');
    for (const row of result.rows) {
      const price = await getStockPrice(row.ticker);
      if (price) {
        await pool.query('UPDATE positions SET current_price = $1 WHERE ticker = $2', [price, row.ticker]);
        console.log(`${row.ticker}: $${price}`);
      }
    }
  } catch(e) {
    console.error('Fiyat guncelleme hatasi:', e);
  }
}

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portföy Takibi</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 16px; padding: 2.5rem; width: 100%; max-width: 400px; border: 1px solid #e8e8e8; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 0.25rem; }
  p { color: #888; font-size: 14px; margin-bottom: 2rem; }
  .tabs { display: flex; gap: 8px; margin-bottom: 1.5rem; }
  .tab { flex: 1; padding: 8px; border: 1px solid #e8e8e8; border-radius: 8px; background: none; cursor: pointer; font-size: 14px; }
  .tab.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  .form { display: none; flex-direction: column; gap: 12px; }
  .form.active { display: flex; }
  input { border: 1px solid #e8e8e8; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
  input:focus { outline: none; border-color: #1a1a1a; }
  button[type=submit] { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 14px; cursor: pointer; font-weight: 500; }
  button[type=submit]:hover { background: #333; }
  .error { color: #dc2626; font-size: 13px; background: #fee2e2; padding: 10px 14px; border-radius: 8px; display: none; }
</style>
</head>
<body>
<div class="card">
  <h1>📊 Portföy Takibi</h1>
  <p>Giriş yap veya hesap oluştur</p>
  <div class="tabs">
    <button class="tab active" onclick="showTab('login')">Giriş yap</button>
    <button class="tab" onclick="showTab('register')">Kayıt ol</button>
  </div>
  <div id="error" class="error"></div>
  <form class="form active" id="login" method="POST" action="/login">
    <input name="username" placeholder="Kullanıcı adı" required>
    <input name="password" type="password" placeholder="Şifre" required>
    <button type="submit">Giriş yap</button>
  </form>
  <form class="form" id="register" method="POST" action="/register">
    <input name="weekly_pass" placeholder="Haftalık şifre" required>
    <input name="username" placeholder="Kullanıcı adı" required>
    <input name="password" type="password" placeholder="Şifre" required>
    <button type="submit">Kayıt ol</button>
  </form>
</div>
<script>
  function showTab(t) {
    document.querySelectorAll('.tab').forEach((b,i) => b.classList.toggle('active', (i===0&&t==='login')||(i===1&&t==='register')));
    document.querySelectorAll('.form').forEach(f => f.classList.toggle('active', f.id===t));
  }
  const p = new URLSearchParams(window.location.search);
  if (p.get('error')) { const e = document.getElementById('error'); e.textContent = decodeURIComponent(p.get('error')); e.style.display = 'block'; }
</script>
</body>
</html>`);
});

app.post('/register', async (req, res) => {
  const { username, password, weekly_pass } = req.body;
  try {
    const wp = await pool.query('SELECT * FROM weekly_password WHERE valid_until > NOW() ORDER BY id DESC LIMIT 1');
    if (!wp.rows.length || wp.rows[0].password !== weekly_pass) {
      return res.redirect('/?error=' + encodeURIComponent('Haftalık şifre yanlış!'));
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id', [username, hash]);
    req.session.userId = result.rows[0].id;
    req.session.username = username;
    res.redirect('/dashboard');
  } catch (e) {
    res.redirect('/?error=' + encodeURIComponent('Kullanıcı adı zaten alınmış!'));
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!result.rows.length) return res.redirect('/?error=' + encodeURIComponent('Kullanıcı bulunamadı!'));
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.redirect('/?error=' + encodeURIComponent('Şifre yanlış!'));
    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].username;
    res.redirect('/dashboard');
  } catch (e) {
    res.redirect('/?error=' + encodeURIComponent('Hata oluştu!'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/dashboard', requireAuth, async (req, res) => {
  await updateAllPrices();
  const positions = await pool.query('SELECT * FROM positions WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]);
  const rows = positions.rows;
  const totalCost = rows.reduce((s, p) => s + parseFloat(p.qty) * parseFloat(p.cost), 0);
  const totalVal = rows.reduce((s, p) => s + parseFloat(p.qty) * parseFloat(p.current_price || p.cost), 0);
  const totalPnl = totalVal - totalCost;

  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portföy — ${req.session.username}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 2rem; }
  .wrap { max-width: 960px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
  h1 { font-size: 22px; font-weight: 600; }
  .logout { font-size: 13px; color: #888; text-decoration: none; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 1.5rem; }
  .metric { background: #fff; border-radius: 12px; padding: 16px 18px; border: 1px solid #e8e8e8; }
  .metric-label { font-size: 12px; color: #888; margin-bottom: 4px; }
  .metric-value { font-size: 22px; font-weight: 500; }
  .pos { color: #16a34a; } .neg { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8; font-size: 14px; margin-bottom: 1rem; }
  thead tr { background: #fafafa; border-bottom: 1px solid #e8e8e8; }
  th { padding: 10px 14px; text-align: left; font-size: 12px; font-weight: 500; color: #888; }
  th.r { text-align: right; }
  td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  .ticker { font-weight: 600; }
  .sub { font-size: 12px; color: #888; margin-top: 2px; }
  .badge { display: inline-block; font-size: 12px; padding: 3px 10px; border-radius: 5px; font-weight: 500; }
  .badge.pos { background: #dcfce7; color: #15803d; }
  .badge.neg { background: #fee2e2; color: #b91c1c; }
  .add-form { background: #fff; border-radius: 12px; padding: 1.25rem; border: 1px solid #e8e8e8; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .form-grid input { border: 1px solid #e8e8e8; border-radius: 8px; padding: 8px 12px; font-size: 13px; width: 100%; }
  .btn { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 9px 20px; font-size: 13px; cursor: pointer; margin-top: 10px; }
  .btn-del { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 12px; }
  .section-label { font-size: 12px; font-weight: 600; color: #888; margin: 1.25rem 0 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
  .refresh { font-size: 12px; color: #888; margin-top: 4px; }
  @media(max-width:600px){ .metrics{grid-template-columns:1fr 1fr;} body{padding:1rem;} }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div>
      <h1>📊 ${req.session.username} — Portföy</h1>
      <p class="refresh">Fiyatlar her sayfa açılışında güncellenir</p>
    </div>
    <a href="/logout" class="logout">Çıkış yap</a>
  </div>

  <div class="metrics">
    <div class="metric"><div class="metric-label">Toplam yatırım</div><div class="metric-value">$${totalCost.toFixed(2)}</div></div>
    <div class="metric"><div class="metric-label">Güncel değer</div><div class="metric-value">$${totalVal.toFixed(2)}</div></div>
    <div class="metric"><div class="metric-label">Kar/Zarar</div><div class="metric-value ${totalPnl >= 0 ? 'pos' : 'neg'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div></div>
  </div>

  <p class="section-label">Pozisyonlar</p>
  <table>
    <thead><tr>
      <th>Hisse</th><th class="r">Adet</th><th class="r">Maliyet</th>
      <th class="r">Güncel</th><th class="r">Değer</th><th class="r">Kar/Zarar</th><th class="r">İşlem</th>
    </tr></thead>
    <tbody>
    ${rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:#888;padding:2rem;">Henüz pozisyon yok</td></tr>' : rows.map(p => {
      const val = parseFloat(p.qty) * parseFloat(p.current_price || p.cost);
      const cost = parseFloat(p.qty) * parseFloat(p.cost);
      const pnl = val - cost;
      const pct = ((parseFloat(p.current_price || p.cost) - parseFloat(p.cost)) / parseFloat(p.cost) * 100);
      return `<tr>
        <td><div class="ticker">${p.ticker}</div>
          <div class="sub">${p.name || ''}</div>
          ${p.stop_price ? `<div class="sub" style="color:#dc2626">Stop: $${p.stop_price}</div>` : ''}
          ${p.target_price ? `<div class="sub" style="color:#16a34a">Hedef: $${p.target_price}</div>` : ''}
        </td>
        <td class="r">${p.qty}</td>
        <td class="r">$${parseFloat(p.cost).toFixed(2)}</td>
        <td class="r">$${parseFloat(p.current_price || p.cost).toFixed(2)}</td>
        <td class="r">$${val.toFixed(2)}</td>
        <td class="r"><span class="badge ${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span><div style="font-size:11px;color:#888;text-align:right">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div></td>
        <td class="r"><button class="btn-del" onclick="deletePos(${p.id})">Sil</button></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>

  <p class="section-label">Yeni pozisyon ekle</p>
  <div class="add-form">
    <div class="form-grid">
      <input id="ticker" placeholder="Ticker (TQQQ)">
      <input id="name" placeholder="Şirket adı">
      <input id="qty" type="number" placeholder="Adet">
      <input id="cost" type="number" placeholder="Maliyet $" step="0.01">
      <input id="stop" type="number" placeholder="Stop $" step="0.01">
      <input id="target" type="number" placeholder="Hedef $" step="0.01">
    </div>
    <button class="btn" onclick="addPos()">+ Ekle</button>
  </div>
</div>
<script>
async function addPos() {
  const data = {
    ticker: document.getElementById('ticker').value.toUpperCase(),
    name: document.getElementById('name').value,
    qty: document.getElementById('qty').value,
    cost: document.getElementById('cost').value,
    stop_price: document.getElementById('stop').value,
    target_price: document.getElementById('target').value
  };
  await fetch('/positions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  location.reload();
}
async function deletePos(id) {
  if (!confirm('Silinsin mi?')) return;
  await fetch('/positions/' + id, { method: 'DELETE' });
  location.reload();
}
</script>
</body>
</html>`);
});

app.post('/positions', requireAuth, async (req, res) => {
  const { ticker, name, qty, cost, stop_price, target_price } = req.body;
  const price = await getStockPrice(ticker);
  await pool.query('INSERT INTO positions (user_id, ticker, name, qty, cost, current_price, stop_price, stop_limit, target_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [req.session.userId, ticker, name, qty, cost, price || cost, stop_price || null, stop_price ? parseFloat(stop_price) - 2 : null, target_price || null]);
  res.json({ ok: true });
});

app.delete('/positions/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM positions WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.get('/admin', requireAuth, async (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Admin</title>
<style>body{font-family:sans-serif;padding:2rem;background:#f5f5f5;}.card{background:#fff;border-radius:12px;padding:2rem;max-width:400px;border:1px solid #e8e8e8;}input{border:1px solid #e8e8e8;border-radius:8px;padding:10px;width:100%;margin-bottom:1rem;font-size:14px;}button{background:#1a1a1a;color:#fff;border:none;border-radius:8px;padding:10px 20px;cursor:pointer;}</style>
</head><body><div class="card"><h2>Haftalık Şifre Güncelle</h2><br>
<form method="POST" action="/admin/password">
<input name="password" placeholder="Yeni haftalık şifre" required>
<button type="submit">Kaydet</button>
</form></div></body></html>`);
});

app.post('/admin/password', requireAuth, async (req, res) => {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO weekly_password (password, valid_from, valid_until) VALUES ($1, $2, $3)', [req.body.password, now, nextWeek]);
  res.send('<p>Şifre güncellendi! <a href="/dashboard">Dashboard</a></p>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sunucu calisiyor: ' + PORT));
