/* K.I.T.T. instrumentpanel – UI, GPS, demo, lägen, turbo, status. Ingen styrning av bilen. */
'use strict';
(function(){
const $ = id => document.getElementById(id);
const L = window.KITT_LINES, A = window.KittAudio, V = window.KittVoice;
const LS = { get(k, d){ try { const v = localStorage.getItem('kitt.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
             set(k, v){ try { localStorage.setItem('kitt.' + k, JSON.stringify(v)); } catch (e) {} } };
const pick = a => a[Math.floor(Math.random() * a.length)];
const pad = n => String(n).padStart(2, '0');
const state = { started: false, mode: 'normal', silent: false, speed: 0, shown: 0, heading: null, pos: null, acc: null, src: 'none', trail: [], turbo: false, lastQuip: -1 };
window.KITT = { state, A, V, log: [] };

/* ---------- 7-segment-display ---------- */
const SEG = { 0:'abcdef', 1:'bc', 2:'abdeg', 3:'abcdg', 4:'bcfg', 5:'acdfg', 6:'acdefg', 7:'abc', 8:'abcdefg', 9:'abcdfg', '-':'g', ' ':'' };
(function buildSpd(){
  const svg = $('spd'); let h = '';
  for (let d = 0; d < 3; d++){
    const x = 4 + d * 62, w = 50, t = 7, y = 4, H = 92, m = H / 2;
    const P = {
      a: `${x+t},${y} ${x+w-t},${y} ${x+w-t*2},${y+t} ${x+t*2},${y+t}`,
      b: `${x+w},${y+t} ${x+w},${y+m-t/2} ${x+w-t},${y+m-t} ${x+w-t},${y+t*2}`,
      c: `${x+w},${y+m+t/2} ${x+w},${y+H-t} ${x+w-t},${y+H-t*2} ${x+w-t},${y+m+t}`,
      d: `${x+t*2},${y+H-t} ${x+w-t*2},${y+H-t} ${x+w-t},${y+H} ${x+t},${y+H}`,
      e: `${x},${y+m+t/2} ${x+t},${y+m+t} ${x+t},${y+H-t*2} ${x},${y+H-t}`,
      f: `${x},${y+t} ${x+t},${y+t*2} ${x+t},${y+m-t} ${x},${y+m-t/2}`,
      g: `${x+t},${y+m} ${x+t*1.6},${y+m-t/2} ${x+w-t*1.6},${y+m-t/2} ${x+w-t},${y+m} ${x+w-t*1.6},${y+m+t/2} ${x+t*1.6},${y+m+t/2}`
    };
    for (const k in P) h += `<polygon class="seg" data-d="${d}" data-s="${k}" points="${P[k]}" transform="skewX(-6) translate(8 0)"/>`;
  }
  svg.innerHTML = h;
})();
const segEls = [...$('spd').querySelectorAll('.seg')];
let lastSpdStr = '';
function setDigits(str){
  str = str.padStart(3, ' ').slice(-3); if (str === lastSpdStr) return; lastSpdStr = str;
  segEls.forEach(el => { const ch = str[+el.dataset.d]; el.classList.toggle('on', (SEG[ch] || '').includes(el.dataset.s)); });
}
/* ---------- LED-staplar ---------- */
function mkBar(el, n, colors){ el.innerHTML = ''; for (let i = 0; i < n; i++){ const s = document.createElement('i'); if (colors) s.className = colors(i, n); el.appendChild(s); } return [...el.children]; }
const barSpeed = mkBar($('barSpeed'), 40, (i, n) => i < n * 0.55 ? 'g' : i < n * 0.8 ? 'a' : 'r');
const gEls = { energy: mkBar($('gEnergy'), 14), temp: mkBar($('gTemp'), 14), sig: mkBar($('gSig'), 14), vol: mkBar($('gVol'), 14) };
function fill(arr, frac, hiFrom){ const k = Math.round(Math.max(0, Math.min(1, frac)) * arr.length); arr.forEach((e, i) => { e.classList.toggle('on', i < k); if (hiFrom) e.classList.toggle('hi', i >= hiFrom); }); }

/* ---------- röstbox (canvas) ---------- */
const vc = $('vbox'), vx = vc.getContext('2d');
const COLS = [{n: 11, f: 0.62}, {n: 17, f: 1}, {n: 11, f: 0.62}];
let lv = [0, 0, 0], vboxStats = { frames: 0, litWhilePlaying: 0, playingFrames: 0, litWhileSilent: 0, silentFrames: 0, samples: [] };
function sizeCanvas(c){ const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr)); if (c.width !== w || c.height !== h){ c.width = w; c.height = h; } return [w, h, dpr]; }
function drawVbox(lev){
  const [W, H] = sizeCanvas(vc); vx.clearRect(0, 0, W, H);
  const colW = W * 0.2, gap = (W - colW * 3) / 4; let lit = 0;
  COLS.forEach((col, ci) => {
    const x = gap + ci * (colW + gap), totalH = H * (ci === 1 ? 0.98 : 0.66), y0 = (H - totalH) / 2;
    const segH = totalH / col.n, half = (col.n - 1) / 2, L = ci === 1 ? lev[1] : lev[0] * (ci === 0 ? 1 : 0.94) ;
    const reach = L * (half + 0.999);
    for (let s = 0; s < col.n; s++){
      const dist = Math.abs(s - half), on = L > 0.02 && dist < reach, y = y0 + s * segH + segH * 0.14;
      vx.fillStyle = on ? (dist > half - 1.5 ? '#ff5a3a' : '#ff2414') : '#2a0503';
      if (on){ vx.shadowColor = '#ff2000'; vx.shadowBlur = 12; lit++; } else vx.shadowBlur = 0;
      vx.fillRect(x, y, colW, segH * 0.72);
    }
  });
  vx.shadowBlur = 0; return lit;
}

/* ---------- radar ---------- */
const rc = $('radar'), rx = rc.getContext('2d');
function crtColor(){ return getComputedStyle($('crt2')).getPropertyValue('--crt').trim() || '#ffb22e'; }
let radarColor = '#ffb22e';
function drawRadar(){
  const [W, H, dpr] = sizeCanvas(rc); rx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46, col = radarColor;
  rx.strokeStyle = col; rx.fillStyle = col; rx.lineWidth = 1 * dpr; rx.globalAlpha = 0.35;
  for (let i = 1; i <= 3; i++){ rx.beginPath(); rx.arc(cx, cy, R * i / 3, 0, 7); rx.stroke(); }
  rx.beginPath(); rx.moveTo(cx - R, cy); rx.lineTo(cx + R, cy); rx.moveTo(cx, cy - R); rx.lineTo(cx, cy + R); rx.stroke();
  rx.globalAlpha = 0.8; rx.font = `${10 * dpr}px Courier New`; rx.textAlign = 'center'; rx.fillText('N', cx, cy - R - 2 * dpr + 10 * dpr * 0.2);
  // spår (norr upp), skala 1 km i ytterring
  const scale = R / 1000;
  if (state.pos && state.trail.length){
    const lat0 = state.pos.lat, lon0 = state.pos.lon, k = Math.cos(lat0 * Math.PI / 180) * 111320;
    state.trail.forEach((p, i) => { const dx = (p.lon - lon0) * k * scale, dy = -(p.lat - lat0) * 110540 * scale; if (dx * dx + dy * dy > R * R) return;
      rx.globalAlpha = 0.15 + 0.75 * i / state.trail.length; rx.fillRect(cx + dx - 1.5 * dpr, cy + dy - 1.5 * dpr, 3 * dpr, 3 * dpr); });
  }
  rx.globalAlpha = 1;
  // bilsymbol
  rx.save(); rx.translate(cx, cy); rx.rotate(((state.heading || 0) * Math.PI) / 180);
  rx.beginPath(); rx.moveTo(0, -9 * dpr); rx.lineTo(6 * dpr, 7 * dpr); rx.lineTo(0, 4 * dpr); rx.lineTo(-6 * dpr, 7 * dpr); rx.closePath();
  rx.shadowColor = col; rx.shadowBlur = 8; rx.fill(); rx.restore();
  rx.globalAlpha = 0.6; rx.textAlign = 'left'; rx.fillText('1 KM', 4 * dpr, H - 4 * dpr); rx.globalAlpha = 1;
}

/* ---------- CRT-logg ---------- */
const logEl = $('log');
function now(){ const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function logLine(txt, who){
  const p = document.createElement('p'); if (who === 'sys') p.className = 'sys';
  p.innerHTML = `<em>${now()} ${who === 'sys' ? 'SYS' : 'KITT'}&gt;</em> `; const span = document.createElement('span'); p.appendChild(span); span.className = 'cursor';
  logEl.appendChild(p); while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
  let i = 0; const tick = () => { i += 2; span.textContent = txt.slice(0, i); if (i < txt.length) setTimeout(tick, 18); else span.className = ''; }; tick();
  window.KITT.log.push({who: who || 'kitt', txt});
}
function say(txt, opts = {}){
  if (opts.interrupt) V.cancel();
  logLine(txt.replace(/\bKitt\b/g, 'KITT'), 'kitt');
  const m = V.say(txt); if (m === 'wait') logLine('Röstmodulen laddar – repliken spelas när den är klar.', 'sys');
  return m;
}

/* ---------- status-chips ---------- */
function chip(id, cls, text){ const c = $(id); c.querySelector('.dot').className = 'dot ' + (cls || ''); c.querySelector('span').textContent = text; }
V.onstate = v => {
  if (v.state === 'loading') chip('cVoice', 'warn', 'RÖSTMODUL: LADDAR ' + v.pct + '%');
  else if (v.state === 'ready'){ chip('cVoice', 'ok', 'RÖSTMODUL: KLAR'); if (!v._logged){ v._logged = 1; const i = v.info; logLine(`Röstmodul klar (${(i.bytes / 1048576).toFixed(0)} MB, ${i.fromCache ? 'från cache' : 'nedladdad'}, ${(i.ms / 1000).toFixed(1)} s).`, 'sys'); } }
  else if (v.state === 'error'){ chip('cVoice', 'err', v.svVoice ? 'RÖST: SYSTEMRÖST' : 'RÖST: ENDAST TEXT'); if (!v._elog){ v._elog = 1; logLine('Röstmodulen kunde inte laddas: ' + (v.err || 'okänt fel') + '. ' + (v.svVoice ? 'Använder webbläsarens röst.' : 'Visar text i stället.'), 'sys'); } }
};
function toast(t, ms = 4000){ const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms); }

/* ---------- GPS ---------- */
const GPS = {
  id: null, last: null,
  start(){
    if (!('geolocation' in navigator)){ chip('cGps', 'err', 'GPS: SAKNAS'); return; }
    chip('cGps', 'warn', 'GPS: SÖKER');
    const opt = {enableHighAccuracy: true, maximumAge: 1000, timeout: 20000};
    // engångsfråga först (äldre Tesla-webbläsare)
    navigator.geolocation.getCurrentPosition(p => this.on(p), e => this.err(e), opt);
    try { this.id = navigator.geolocation.watchPosition(p => this.on(p), e => this.err(e), opt); } catch (e) {}
  },
  stop(){ if (this.id !== null) navigator.geolocation.clearWatch(this.id); this.id = null; },
  on(p){
    if (Demo.on) return;
    const c = p.coords, t = p.timestamp || Date.now(); let v = (c.speed != null && !isNaN(c.speed)) ? c.speed * 3.6 : null;
    if (v === null && this.last){ const dt = (t - this.last.t) / 1000; if (dt > 0.4) v = dist(this.last.lat, this.last.lon, c.latitude, c.longitude) / dt * 3.6; }
    let hd = (c.heading != null && !isNaN(c.heading) && (v || 0) > 3) ? c.heading : null;
    if (hd === null && this.last && dist(this.last.lat, this.last.lon, c.latitude, c.longitude) > 8) hd = bearing(this.last.lat, this.last.lon, c.latitude, c.longitude);
    this.last = {lat: c.latitude, lon: c.longitude, t};
    setPos(c.latitude, c.longitude, v === null ? state.speed : v, hd, c.accuracy, 'gps');
    chip('cGps', c.accuracy < 50 ? 'ok' : 'warn', 'GPS: ±' + Math.round(c.accuracy) + ' M');
  },
  err(e){ if (Demo.on) return; chip('cGps', 'err', e.code === 1 ? 'GPS: NEKAD' : 'GPS: INGEN SIGNAL');
    if (e.code === 1 && !this.warned){ this.warned = 1; toast('Platsåtkomst nekades. Tillåt plats i webbläsaren, eller tryck DEMO för en simulerad tur.', 6000); } }
};
function dist(a, b, c, d){ const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
function bearing(a, b, c, d){ const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return (Math.atan2(y, x) / r + 360) % 360; }
function setPos(lat, lon, v, hd, acc, src){
  state.speed = Math.max(0, v || 0); if (hd !== null && hd !== undefined) state.heading = hd; state.acc = acc; state.src = src;
  state.pos = {lat, lon}; const lt = state.trail[state.trail.length - 1];
  if (!lt || dist(lt.lat, lt.lon, lat, lon) > 15){ state.trail.push({lat, lon}); if (state.trail.length > 160) state.trail.shift(); }
}
const DIRS = ['norr', 'nordost', 'öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst'];
const DIRS_S = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];
const dirIdx = h => Math.round(((h % 360) + 360) % 360 / 45) % 8;

/* ---------- demo: simulerad tur runt Stockholm ---------- */
const Demo = {
  on: false, t: 0, lat0: 59.3326, lon0: 18.0649, last: 0,
  toggle(on){
    this.on = on; $('bDemo').classList.toggle('on', on);
    if (on){ state.trail = []; this.t = 0; this.last = performance.now(); chip('cGps', 'warn', 'GPS: DEMOLÄGE'); }
    else { state.speed = 0; state.trail = []; chip('cGps', 'warn', 'GPS: SÖKER'); }
  },
  step(){
    if (!this.on) return; const n = performance.now(), dt = Math.min(0.5, (n - this.last) / 1000); this.last = n;
    // hastighetsprofil: start, stad, landsväg, motorväg, inbromsning, rödljus (ca 3 min loop)
    const T = 180; this.t = (this.t + dt) % T; const t = this.t;
    const prof = [[0, 0], [8, 42], [30, 50], [40, 0], [48, 0], [60, 70], [90, 82], [105, 112], [140, 118], [155, 64], [172, 30], [180, 0]];
    let v = 0; for (let i = 0; i < prof.length - 1; i++){ const [ta, va] = prof[i], [tb, vb] = prof[i + 1]; if (t >= ta && t <= tb){ const f = (t - ta) / (tb - ta); v = va + (vb - va) * (0.5 - Math.cos(f * Math.PI) / 2); break; } }
    v += Math.sin(n / 900) * (v > 5 ? 1.5 : 0);
    // position längs en mjuk slinga
    this.s = (this.s || 0) + v / 3.6 * dt; const L = 9000, a = this.s / L * Math.PI * 2;
    const x = 2600 * Math.sin(a) + 700 * Math.sin(3 * a), y = 1700 * Math.sin(2 * a) * 0.9 + 400 * Math.cos(a);
    const lat = this.lat0 + y / 110540 + 0.012, lon = this.lon0 + x / (111320 * Math.cos(this.lat0 * Math.PI / 180));
    const da = 0.001, x2 = 2600 * Math.sin(a + da) + 700 * Math.sin(3 * (a + da)), y2 = 1700 * Math.sin(2 * (a + da)) * 0.9 + 400 * Math.cos(a + da);
    const hd = (Math.atan2(x2 - x, y2 - y) * 180 / Math.PI + 360) % 360;
    setPos(lat, lon, v, hd, 5, 'demo');
  }
};

/* ---------- omvänd geokodning (Nominatim, artig: max 1 anrop/30 s, cache per 400 m) ---------- */
const Geo = {
  last: null, lastAt: 0, busy: null,
  async place(){
    if (!state.pos) return null; const {lat, lon} = state.pos;
    if (this.last && (dist(this.last.lat, this.last.lon, lat, lon) < 400 || Date.now() - this.lastAt < 30000)) return this.last.name;
    if (this.busy) return this.busy;
    this.lastAt = Date.now();
    this.busy = (async () => {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=sv&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, {signal: ctl.signal});
        clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(), a = j.address || {};
        const local = a.suburb || a.city_district || a.village || a.town || a.hamlet || a.neighbourhood || a.city || a.municipality;
        const big = (a.city && a.city !== local) ? a.city : (a.municipality && a.municipality !== local ? a.municipality : a.county);
        const name = [local, big].filter(Boolean).join(', ') || (j.name || null);
        this.last = {lat, lon, name}; return name;
      } catch (e) { console.warn('Geokodning:', e.message || e); return this.last ? this.last.name : null; }
      finally { this.busy = null; }
    })();
    return this.busy;
  }
};

/* ---------- tid på dygnet ---------- */
const NUM = ['tolv', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv', 'tretton', 'fjorton'];
function clockWords(d = new Date()){
  const h = d.getHours(), m = d.getMinutes(), H = i => NUM[(i % 12)], hn = h + 1;
  if (m === 0) return 'prick ' + H(h);
  if (m === 15) return 'kvart över ' + H(h);
  if (m === 30) return 'halv ' + H(hn);
  if (m === 45) return 'kvart i ' + H(hn);
  if (m < 25) return (m <= 14 ? NUM[m] : m) + ' över ' + H(h);
  if (m < 30) return (30 - m) + ' i halv ' + H(hn);
  if (m <= 35) return (m - 30) + ' över halv ' + H(hn);
  const r = 60 - m; return (r <= 14 ? NUM[r] : r) + ' i ' + H(hn);
}
function greetingWord(d = new Date()){ const h = d.getHours(); return h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 12 ? 'God förmiddag' : h < 18 ? 'God eftermiddag' : h < 23 ? 'God kväll' : 'God natt'; }

/* ---------- handlingar ---------- */
function setMode(m, speak = true){
  state.mode = m; LS.set('mode', m);
  document.body.classList.remove('mode-normal', 'mode-auto', 'mode-pursuit'); document.body.classList.add('mode-' + m);
  document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  setTimeout(() => { radarColor = crtColor(); }, 0);
  if (speak){ A.beep(m === 'pursuit' ? 880 : 660, 0.08, 'square', 0.05); say(pick(L[m]), {interrupt: true}); }
}
function setSilent(on){
  state.silent = on; $('bSilent').classList.toggle('on', on);
  if (on){ V.cancel(); A.setMuted(true); say(L.silentOn); }
  else { A.setMuted(false); say(L.silentOff, {interrupt: true}); }
}
function setVol(v){ A.setVol(v); $('volV').textContent = A.vol; LS.set('vol', A.vol); fill(gEls.vol, A.vol / 10, 12); A.beep(900 + A.vol * 60, 0.05, 'square', 0.05); }
function turbo(){
  if (state.turbo) return; state.turbo = true; const ov = $('turbo'), tc = $('tCount');
  say(pick(L.turbo), {interrupt: true});
  let n = 3; ov.classList.add('show'); tc.textContent = n; A.beep(520, 0.12, 'square', 0.07);
  const iv = setInterval(() => {
    n--; if (n > 0){ tc.textContent = n; A.beep(520 + (3 - n) * 140, 0.12, 'square', 0.07); return; }
    clearInterval(iv); tc.textContent = 'GO'; A.whoosh(); document.body.classList.add('turbo');
    setTimeout(() => { ov.classList.remove('show'); }, 900);
    setTimeout(() => { document.body.classList.remove('turbo'); state.turbo = false; say(pick(L.turboDone)); }, 2700);
  }, 1000);
}
async function status(){
  A.beep(1400, 0.05);
  const parts = [pick(L.statusPre)];
  if (!state.pos){ parts.push(L.statusNoGps); }
  else {
    const v = Math.round(state.speed);
    if (v < 3) parts.push(L.statusStill);
    else parts.push(`Vi färdas i ${v} kilometer i timmen` + (state.heading != null ? `, riktning ${DIRS[dirIdx(state.heading)]}.` : '.'));
  }
  parts.push(`Klockan är ${clockWords()}.`);
  if (state.pos){
    logLine('Hämtar platsnamn …', 'sys');
    const name = await Geo.place();
    parts.push(name ? `Vi befinner oss i närheten av ${name}.` : 'Platsnamnet kunde jag inte fastställa, men jag är övertygad om att det är vackert.');
  }
  say(parts.join(' '), {interrupt: true});
}
function quip(){ let i; do { i = Math.floor(Math.random() * L.quips.length); } while (i === state.lastQuip && L.quips.length > 1); state.lastQuip = i; A.beep(1100, 0.04); say(L.quips[i]); }
const DECO = {
  eval: 'Utvärdering klar. Allt är i sin ordning, med ett möjligt undantag bakom ratten.',
  comp: 'Kompassmodulen säger att vi är på väg någonstans. Mer exakt än så vill jag inte vara.',
  traj: 'Banberäkning genomförd. Vi rör oss framåt, vilket jag rekommenderar att vi fortsätter med.',
  test: 'Systemtest genomfört. Alla lampor fungerar, även de som inte gör någonting alls.'
};
function lampTest(){ document.body.classList.add('lamptest'); A.beep(1600, 0.2, 'sine', 0.05); setTimeout(() => document.body.classList.remove('lamptest'), 1600); say(DECO.test); }
function openPrata(on){ $('prata').classList.toggle('show', on); if (on) setTimeout(() => { try { $('prText').focus({preventScroll: true}); } catch (e) {} }, 50); }
function crtView(which){ const r = document.querySelector('.panel.right'); const cls = 'only-' + which, on = !r.classList.contains(cls);
  r.classList.remove('only-log', 'only-radar'); if (on) r.classList.add(cls);
  $('bLog').classList.toggle('on', on && which === 'log'); $('bRadar').classList.toggle('on', on && which === 'radar'); }

// presets
L.presets.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => { say(t, {interrupt: true}); openPrata(false); }; $('presets').appendChild(b); });
$('prForm').addEventListener('submit', e => { e.preventDefault(); const t = $('prText').value.trim(); if (!t) return; say(t, {interrupt: true}); $('prText').value = ''; openPrata(false); });

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-mode]'); if (!b || !state.started) return;
  A.unlock();
  if (b.dataset.mode) return setMode(b.dataset.mode);
  switch (b.dataset.act){
    case 'turbo': return turbo();
    case 'silent': return setSilent(!state.silent);
    case 'status': return status();
    case 'prata': A.beep(1000, 0.04); return openPrata(true);
    case 'prata-close': return openPrata(false);
    case 'quip': return quip();
    case 'demo': A.beep(800, 0.05); Demo.toggle(!Demo.on); return say(Demo.on ? 'Demoläge aktiverat. Jag simulerar en tur runt Stockholm. Ingen fortkörning, jag lovar.' : 'Demoläget är avslutat. Tillbaka till verkligheten, tyvärr.');
    case 'vol-': return setVol(A.vol - 1);
    case 'vol+': return setVol(A.vol + 1);
    case 'crt-log': A.beep(1300, 0.03); return crtView('log');
    case 'crt-radar': A.beep(1300, 0.03); return crtView('radar');
    case 'test': return lampTest();
    case 'deco': b.classList.toggle('on'); A.beep(1500, 0.03); return say(DECO[b.dataset.say]);
  }
});
$('prata').addEventListener('click', e => { if (e.target.id === 'prata') openPrata(false); });

/* ---------- Wake Lock ---------- */
let wake = null;
async function keepAwake(){
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible'){ wake = await navigator.wakeLock.request('screen'); chip('cWake', 'ok', 'SKÄRM: VAKEN');
      wake.addEventListener('release', () => chip('cWake', 'warn', 'SKÄRM')); } else chip('cWake', '', 'SKÄRM'); } catch (e) { chip('cWake', 'warn', 'SKÄRM'); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.started){ keepAwake(); A.resume(); } });

/* ---------- start ---------- */
function start(){
  if (state.started) return; state.started = true;
  A.unlock(); A.setVol(LS.get('vol', 7)); $('volV').textContent = A.vol; fill(gEls.vol, A.vol / 10, 12);
  $('start').classList.remove('show');
  V.init(); keepAwake(); GPS.start();
  if (new URLSearchParams(location.search).has('demo')) Demo.toggle(true);
  A.beep(440, 0.12, 'sine', 0.06); setTimeout(() => A.beep(880, 0.16, 'sine', 0.05), 130);
  logLine('System startat. Ingen styrning av bilen – bara grafik och röst.', 'sys');
  say(pick(L.greet).replace('{hälsning}', greetingWord()));
}
$('goBtn').addEventListener('click', start);
setMode(LS.get('mode', 'normal'), false);
fill(gEls.vol, LS.get('vol', 7) / 10, 12);
setDigits('0');

/* ---------- huvudloop ---------- */
let lastT = performance.now(), envT = 0, smooth = [0, 0];
function frame(t){
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  Demo.step();
  // hastighet
  state.shown += (state.speed - state.shown) * Math.min(1, dt * 4);
  if (state.turbo && document.body.classList.contains('turbo')) setDigits(String(Math.floor(200 + Math.random() * 99)));
  else setDigits(state.src === 'none' ? '--' : String(Math.round(state.shown)));
  fill(barSpeed, (state.turbo && document.body.classList.contains('turbo')) ? 1 : state.shown / 200);
  // röstnivåer
  let lev = [0, 0];
  if (V.playing){ const l = A.levels(); lev = [l[0], l[1]]; }
  else if (V.speaking){ const s = V.simLevel(); lev = [s * 0.7, s]; }
  for (let i = 0; i < 2; i++){ const a = lev[i] > smooth[i] ? 0.6 : 0.25; smooth[i] += (lev[i] - smooth[i]) * a; }
  if (state.mode === 'pursuit' && !V.speaking){ smooth[0] *= 0.9; }
  const lit = drawVbox(smooth);
  const S = vboxStats; S.frames++; if (V.playing){ S.playingFrames++; if (lit > 0) S.litWhilePlaying++; if (S.samples.length < 4000) S.samples.push([+(A.levels()[2] || 0).toFixed(4), lit]); }
  else if (!V.speaking){ S.silentFrames++; if (lit > 0) S.litWhileSilent++; }
  // lampor
  envT += dt;
  const sp = V.speaking, Lmp = q => document.querySelector(`.lamp[data-l="${q}"]`);
  Lmp('air').classList.toggle('on', true); Lmp('oil').classList.toggle('on', state.mode !== 'normal' || sp);
  Lmp('p1').classList.toggle('on', state.mode === 'pursuit' || (sp && smooth[1] > 0.3));
  Lmp('p2').classList.toggle('on', state.mode === 'pursuit' || state.turbo);
  Lmp('p3').classList.toggle('on', state.turbo || (state.mode === 'pursuit' && (envT % 1) < 0.5));
  Lmp('p4').classList.toggle('on', state.turbo || (state.mode === 'pursuit' && (envT % 1) >= 0.5));
  Lmp('s1').classList.toggle('on', state.src !== 'none'); Lmp('s2').classList.toggle('on', V.state === 'ready');
  // mätare (bara visuella)
  fill(gEls.energy, 0.78 - Math.min(0.2, state.shown / 1000) + (state.turbo ? 0.2 : 0));
  fill(gEls.temp, 0.38 + state.shown / 450 + (state.mode === 'pursuit' ? 0.2 : 0) + (state.turbo ? 0.4 : 0), 11);
  fill(gEls.sig, state.src === 'none' ? 0 : state.src === 'demo' ? 0.9 : Math.max(0.1, 1 - (state.acc || 100) / 120));
  // radar + navtext (ca 8 bilder/s)
  if (!frame.n || t - frame.n > 120){ frame.n = t; drawRadar();
    const hd = state.heading != null ? Math.round(state.heading) + '° ' + DIRS_S[dirIdx(state.heading)] : '--';
    $('crt2Info').textContent = state.src === 'demo' ? 'DEMO' : state.src === 'gps' ? 'GPS' : 'INGEN POS';
    $('navTxt').textContent = state.pos ? `${state.pos.lat.toFixed(4)}N ${state.pos.lon.toFixed(4)}E  KURS ${hd}${Geo.last ? '  ' + Geo.last.name.toUpperCase() : ''}` : 'VÄNTAR PÅ POSITION …';
    const d = new Date(); $('cClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('crt1Info').textContent = V.state === 'ready' ? (state.silent ? 'TYST' : (V.mode === 'tts' ? 'NEURAL RÖST' : V.mode.toUpperCase())) : V.state === 'loading' ? V.pct + '%' : V.state === 'error' ? (V.svVoice ? 'SYSTEMRÖST' : 'TEXT') : '';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => { radarColor = crtColor(); });
Object.assign(window.KITT, { say, setMode, turbo, status, quip, setSilent, setVol, Demo, Geo, vboxStats, clockWords, start });
})();
