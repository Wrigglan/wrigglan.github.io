'use strict';
/* Fototips – fina foto- och filmplatser nära bilen. Statisk app, inga nycklar, ingen spårning. */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = { get(k, d){ try { const v = localStorage.getItem('foto_' + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('foto_' + k, JSON.stringify(v)); } catch(e){ /* full */ } } };

/* ---------- Geometri ---------- */
const R_E = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function dist(a, b, c, d){ const p1=rad(a), p2=rad(c), dp=rad(c-a), dl=rad(d-b);
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return 2*R_E*Math.asin(Math.sqrt(h)); }
function bearing(a, b, c, d){ const p1=rad(a), p2=rad(c), dl=rad(d-b);
  return (deg(Math.atan2(Math.sin(dl)*Math.cos(p2), Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl))) + 360) % 360; }
const COMP = ['norr','nordost','öster','sydost','söder','sydväst','väster','nordväst'];
const COMP_SHORT = ['N','NO','O','SO','S','SV','V','NV'];
const compass = b => COMP[Math.round(((b % 360) + 360) % 360 / 45) % 8];
const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d; };
function relDir(rel){ const a = Math.abs(rel);
  if (a < 20) return 'rakt fram'; if (a < 60) return rel > 0 ? 'snett höger fram' : 'snett vänster fram';
  if (a < 120) return rel > 0 ? 'till höger' : 'till vänster'; if (a < 160) return rel > 0 ? 'snett höger bak' : 'snett vänster bak'; return 'bakom dig'; }
const fmtKm = m => m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',') + ' km';
const fmtT = d => d && !isNaN(d) ? d.toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'}) : '–';
function fmtDur(ms){ const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }

/* ---------- Sol (SunCalc-matematik, V. Agafonkin, BSD) ---------- */
const SUN = (() => {
  const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad(23.4397);
  const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970, fromJulian = j => new Date((j + 0.5 - J1970) * dayMs), toDays = d => toJulian(d) - J2000;
  const ra = (l, b) => Math.atan2(Math.sin(l)*Math.cos(e) - Math.tan(b)*Math.sin(e), Math.cos(l));
  const dec = (l, b) => Math.asin(Math.sin(b)*Math.cos(e) + Math.cos(b)*Math.sin(e)*Math.sin(l));
  const az = (H, phi, d) => Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(phi) - Math.tan(d)*Math.cos(phi));
  const alt = (H, phi, d) => Math.asin(Math.sin(phi)*Math.sin(d) + Math.cos(phi)*Math.cos(d)*Math.cos(H));
  const sidereal = (d, lw) => rad(280.16 + 360.9856235 * d) - lw;
  const M = d => rad(357.5291 + 0.98560028 * d);
  const L = m => m + rad(1.9148*Math.sin(m) + 0.02*Math.sin(2*m) + 0.0003*Math.sin(3*m)) + rad(102.9372) + Math.PI;
  const coords = d => { const m = M(d), l = L(m); return {dec: dec(l, 0), ra: ra(l, 0)}; };
  function position(date, lat, lng){ const lw = rad(-lng), phi = rad(lat), d = toDays(date), c = coords(d), H = sidereal(d, lw) - c.ra;
    return {azimuth: (deg(az(H, phi, c.dec)) + 180) % 360, altitude: deg(alt(H, phi, c.dec))}; }
  const J0 = 0.0009;
  const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2*Math.PI));
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2*Math.PI) + n;
  const solarTransitJ = (ds, m, l) => J2000 + ds + 0.0053*Math.sin(m) - 0.0069*Math.sin(2*l);
  const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi)*Math.sin(d)) / (Math.cos(phi)*Math.cos(d)));
  function times(date, lat, lng){
    const noonish = new Date(date); noonish.setHours(12, 0, 0, 0);
    const lw = rad(-lng), phi = rad(lat), d = toDays(noonish), n = julianCycle(d, lw), ds = approxTransit(0, lw, n),
      m = M(ds), l = L(m), dc = dec(l, 0), Jnoon = solarTransitJ(ds, m, l);
    const r = {noon: fromJulian(Jnoon)};
    const get = h => { const w = hourAngle(rad(h), phi, dc); const a = approxTransit(w, lw, n); const Jset = solarTransitJ(a, m, l); return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)]; };
    [[-0.833,'sunrise','sunset'],[-6,'blueStartAM','blueEndPM'],[-4,'goldStartAM','blueStartPM'],[6,'goldEndAM','goldStartPM']].forEach(([h, a, b]) => { const [x, y] = get(h); r[a] = x; r[b] = y; });
    r.blueEndAM = r.goldStartAM; r.goldEndPM = r.blueStartPM; return r; }
  return {position, times};
})();
const valid = d => d instanceof Date && !isNaN(d);
function lightPhase(lat, lon, now){
  const t = SUN.times(now, lat, lon), p = SUN.position(now, lat, lon), alt = p.altitude, am = now < t.noon;
  let phase, ico;
  if (alt < -6){ phase = 'natt'; ico = '🌙'; } else if (alt < -4){ phase = 'blå'; ico = '🔵'; } else if (alt < 6){ phase = 'gyllene'; ico = '🌅'; } else { phase = 'dag'; ico = alt > 35 ? '☀️' : '🌤️'; }
  const ev = [['Blå timmen börjar', t.blueStartAM, 'blå'], ['Gyllene timmen börjar', t.goldStartAM, 'gyllene'], ['Gyllene timmen slutar', t.goldEndAM, 'end'],
    ['Gyllene timmen börjar', t.goldStartPM, 'gyllene'], ['Blå timmen börjar', t.blueStartPM, 'blå'], ['Blå timmen slutar', t.blueEndPM, 'end']].filter(x => valid(x[1]));
  let big, sub = '', cls = '';
  const next = ev.find(x => x[1] > now);
  const nextEnd = arr => { const x = ev.find(y => y[1] > now && y[0] !== arr); return x; };
  if (phase === 'gyllene'){ cls = 'gold'; const end = ev.find(x => x[1] > now); big = 'Gyllene timmen pågår' + (end ? ' – ' + fmtDur(end[1] - now) + ' kvar' : '') + ' ✨'; sub = am ? 'Mjukt morgonljus – perfekt för b-roll nu.' : 'Varmt kvällsljus – ut och filma!'; }
  else if (phase === 'blå'){ cls = 'blue'; const end = ev.find(x => x[1] > now); big = 'Blå timmen pågår' + (end ? ' – ' + fmtDur(end[1] - now) + ' kvar' : ''); sub = 'Djupblå himmel – fint för stadsljus, broar och fyrar.'; }
  else if (next){ big = next[0] + ' om ' + fmtDur(next[1] - now); sub = phase === 'dag' ? (alt > 35 ? 'Hårt middagsljus just nu – leta skugga eller filma detaljer.' : 'Dagsljus.') + ' Solnedgång ' + fmtT(t.sunset) + '.' : 'Mörkt nu. Soluppgång ' + fmtT(t.sunrise) + '.'; }
  else { const tm = SUN.times(new Date(now.getTime() + 864e5), lat, lon); big = valid(tm.goldStartAM) ? 'Gyllene timmen börjar i morgon ' + fmtT(tm.goldStartAM) : (alt > 0 ? 'Midnattssol – ljust dygnet runt' : 'Polarnatt – ingen soluppgång idag'); sub = valid(tm.sunrise) ? 'Soluppgång i morgon ' + fmtT(tm.sunrise) + '.' : ''; }
  return {phase, ico, big, sub, cls, t, pos: p};
}

/* ---------- Typer ---------- */
const TYPES = {
  viewpoint: {ico:'🔭', name:'Utsiktsplats', w:10}, waterfall: {ico:'💦', name:'Vattenfall', w:9}, lighthouse: {ico:'🗼', name:'Fyr', w:9},
  castle: {ico:'🏰', name:'Slott/borg', w:8}, peak: {ico:'⛰️', name:'Topp', w:7}, ruins: {ico:'🏚️', name:'Ruin', w:7}, fort: {ico:'🛡️', name:'Fästning', w:7},
  bridge: {ico:'🌉', name:'Bro', w:6}, beach: {ico:'🏖️', name:'Strand', w:5}, attraction: {ico:'⭐', name:'Sevärdhet', w:5}
};
function classify(t){
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.waterway === 'waterfall') return 'waterfall';
  if (t.man_made === 'lighthouse') return 'lighthouse';
  if (t.historic === 'castle') return 'castle';
  if (t.historic === 'fort' || t.historic === 'fortress') return 'fort';
  if (t.historic === 'ruins') return 'ruins';
  if (t.natural === 'peak') return 'peak';
  if (t.man_made === 'bridge' || t.bridge) return 'bridge';
  if (t.natural === 'beach') return 'beach';
  if (t.tourism === 'attraction') return 'attraction';
  return null;
}
const DIR_WORDS = {N:0,NNE:22,NE:45,ENE:67,E:90,ESE:112,SE:135,SSE:157,S:180,SSW:202,SW:225,WSW:247,W:270,WNW:292,NW:315,NNW:337};
function parseDir(v){ if (!v) return null; v = String(v).trim().toUpperCase();
  if (/^\d+(\.\d+)?$/.test(v)) return +v % 360;
  const m = v.match(/^(\d+)\s*-\s*(\d+)$/); if (m){ let a = +m[1], b = +m[2]; if (b < a) b += 360; return ((a + b) / 2) % 360; }
  return v in DIR_WORDS ? DIR_WORDS[v] : null; }

/* ---------- Nätverk ---------- */
let netFails = 0;
function setNet(ok, txt){ $('dNet').className = 'dot ' + (ok === true ? 'ok' : ok === false ? 'err' : 'warn'); $('tNet').textContent = txt; }
async function fetchJSON(url, opt = {}, ms = 25000){
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, {...opt, signal: ac.signal}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); } }
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
function overpassQuery(lat, lon, r){
  // bbox är betydligt snabbare än around på belastade servrar; avståndet filtreras i klienten
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(rad(lat)));
  const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(4)).join(',');
  return `[out:json][timeout:45][bbox:${bb}];(
nwr["tourism"="viewpoint"];nwr["natural"="peak"]["name"];nwr["man_made"="lighthouse"];nwr["waterway"="waterfall"];
nwr["historic"~"^(castle|ruins|fort|fortress)$"];nwr["natural"="beach"]["name"];
nwr["man_made"="bridge"]["name"];way["bridge"]["name"]["wikipedia"];way["bridge"]["name"]["wikidata"];
nwr["tourism"="attraction"]["wikipedia"];nwr["tourism"="attraction"]["wikidata"];
);out center tags 500;`; }
async function overpass(lat, lon, r){
  let last;
  const good = LS.get('opgood', null), eps = good && OVERPASS.includes(good) ? [good, ...OVERPASS.filter(x => x !== good)] : OVERPASS;
  for (const ep of [...eps, ...eps.slice(0, 2)]){ // en extra runda på de två första
    try { const j = await fetchJSON(ep, {method:'POST', body:'data=' + encodeURIComponent(overpassQuery(lat, lon, r)), headers:{'Content-Type':'application/x-www-form-urlencoded'}}, ep.includes('overpass-api.de') ? 15000 : 45000);
      if (!j || !j.elements) throw new Error('tomt svar'); LS.set('opgood', ep); return j.elements; }
    catch(e){ last = e; console.warn('Overpass misslyckades', ep, e.message); }
  }
  throw last || new Error('Overpass');
}
const commonsCache = new Map();
async function commons(lat, lon, radius, limit){
  const key = lat.toFixed(4) + ',' + lon.toFixed(4) + ',' + radius + ',' + limit;
  if (commonsCache.has(key)) return commonsCache.get(key);
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggsnamespace=6' +
    `&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&ggsradius=${Math.min(10000, radius)}&ggslimit=${limit}` +
    '&prop=imageinfo|coordinates&iiprop=url|extmetadata&iiurlwidth=360&iiextmetadatafilter=Artist|LicenseShortName|ObjectName';
  const p = fetchJSON(u, {}, 20000).then(j => {
    const pages = Object.values((j.query && j.query.pages) || {});
    const out = pages.map(pg => { const ii = (pg.imageinfo || [])[0]; if (!ii || !ii.thumburl || /\.(pdf|svg|tif|tiff|webm|ogv)$/i.test(pg.title)) return null;
      const md = ii.extmetadata || {}; const strip = s => (s || '').replace(/<[^>]*>/g, '').trim();
      const c = (pg.coordinates || [])[0];
      return {title: pg.title.replace(/^File:/, ''), thumb: ii.thumburl, page: ii.descriptionurl, author: strip(md.Artist && md.Artist.value).slice(0, 60) || 'okänd',
        lic: strip(md.LicenseShortName && md.LicenseShortName.value) || '', d: c ? dist(lat, lon, c.lat, c.lon) : 0}; }).filter(Boolean).sort((a, b) => a.d - b.d);
    return out; }).catch(e => { commonsCache.delete(key); throw e; });
  commonsCache.set(key, p); return p;
}

/* ---------- Tillstånd ---------- */
const S = Object.assign({radius: 10}, LS.get('settings', {}));
let retryAt = 0, pos = null, heading = null, kmh = null, spots = [], lastQuery = null, querying = false, tab = 'spots';
let fav = LS.get('fav', {}), seen = LS.get('seen', {});
const spotKey = e => e.type[0] + e.id;

function makeSpot(e){
  const t = e.tags || {}, type = classify(t); if (!type) return null;
  const lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon; if (lat == null) return null;
  const name = t['name:sv'] || t.name || t['name:en'] || null;
  if (!name && !['viewpoint','waterfall','lighthouse','peak'].includes(type)) return null;
  return {key: spotKey(e), osm: e.type + '/' + e.id, lat, lon, type, name, tags: t,
    wiki: !!(t.wikipedia || t.wikidata), img: !!(t.image || t.wikimedia_commons), ele: t.ele, dir: parseDir(t.direction) };
}
function dedupe(list){ const out = [];
  for (const s of list){ const dup = out.find(o => o.type === s.type && dist(o.lat, o.lon, s.lat, s.lon) < 150 && (o.name === s.name || !s.name || !o.name));
    if (dup){ if (!dup.name && s.name) Object.assign(dup, s); continue; } out.push(s); }
  return out; }
function isMinorLight(s){
  if (s.type !== 'lighthouse') return false; const t = s.tags || {}, sm = t['seamark:type'] || '';
  if (sm === 'light_major') return false;
  if (/light_minor|light_vessel|beacon/.test(sm)) return true;
  if (!s.name) return true;
  if (/(övre|nedre|fyrlykta|ledfyr|hamnfyr|lykta|sektor|ledljus|leading|upper|lower|front|rear)/i.test(s.name)) return true;
  const h = parseFloat(t.height || t['seamark:light:height']); if (!isNaN(h) && h < 10) return true;
  return !(t.wikipedia || t.wikidata);
}
function score(s){
  if (isMinorLight(s)){ const d0 = pos ? dist(pos.lat, pos.lon, s.lat, s.lon) : 0; return 1.2 / (1 + d0 / (S.radius * 400)); } const d = pos ? dist(pos.lat, pos.lon, s.lat, s.lon) : 0;
  return TYPES[s.type].w * (1 + (s.wiki ? .6 : 0) + (s.img ? .3 : 0) + (s.name ? .25 : 0)) / (1 + d / (S.radius * 400)); }

/* Cache: minne + localStorage (rutnät ~1 km, 24 h) */
const cacheKey = (lat, lon, r) => 'op_' + lat.toFixed(2) + '_' + lon.toFixed(2) + '_' + r;
function cacheGet(lat, lon, r){ const c = LS.get(cacheKey(lat, lon, r)); return c && Date.now() - c.t < 864e5 ? c.s : null; }
function cachePut(lat, lon, r, s){ LS.set(cacheKey(lat, lon, r), {t: Date.now(), s});
  const idx = LS.get('opidx', []); idx.push(cacheKey(lat, lon, r)); while (idx.length > 25){ try { localStorage.removeItem('foto_' + idx.shift()); } catch(e){} } LS.set('opidx', [...new Set(idx)]); }

async function refreshSpots(force){
  if (!pos || querying) return;
  if (!force && !lastQuery && Date.now() < retryAt) return;
  const r = S.radius * 1000;
  if (!force && lastQuery && lastQuery.r === r){
    const moved = dist(lastQuery.lat, lastQuery.lon, pos.lat, pos.lon);
    if (moved < Math.max(800, r * 0.3) || Date.now() - lastQuery.t < 20000) return; // throttla
  }
  const q = {lat: pos.lat, lon: pos.lon, r, t: Date.now()};
  const cached = !force && cacheGet(q.lat, q.lon, r);
  if (cached){ lastQuery = q; spots = cached; render(); setNet(true, 'Data: cache'); return; }
  querying = true; setNet(null, 'Data: söker…'); lastQuery = q;
  if (!spots.length) $('list').innerHTML = '<div class="empty">Söker fina platser inom ' + S.radius + ' km…</div>';
  try {
    const els = await overpass(q.lat, q.lon, r);
    spots = dedupe(els.map(makeSpot).filter(s => s && dist(q.lat, q.lon, s.lat, s.lon) <= r * 1.05));
    cachePut(q.lat, q.lon, r, spots); netFails = 0; setNet(true, 'Data: ' + spots.length + ' platser');
  } catch(e){
    netFails++; setNet(false, 'Data: fel');
    lastQuery = null; retryAt = Date.now() + 25000; // försök igen om en stund, inte direkt
    showMsg('Kunde inte hämta platser från OpenStreetMap just nu (' + esc(e.message || 'nätverksfel') + '). ' + (spots.length ? 'Visar senast hämtade platser.' : 'Försöker igen om en stund.'), 'info', 6000);
  } finally { querying = false; }
  render();
}

/* ---------- Väder (Open-Meteo) ---------- */
let wx = null, wxAt = null;
async function refreshWeather(force){
  if (!pos) return;
  if (!force && wxAt && Date.now() - wxAt.t < 30 * 60000 && dist(wxAt.lat, wxAt.lon, pos.lat, pos.lon) < 20000) return;
  wxAt = {lat: pos.lat, lon: pos.lon, t: Date.now()};
  try {
    const j = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}&hourly=cloud_cover,cloud_cover_low,precipitation,visibility,wind_speed_10m,temperature_2m&forecast_hours=8&timezone=auto`, {}, 15000);
    wx = j.hourly; renderWeather();
  } catch(e){ wxAt.t = Date.now() - 25 * 60000; $('wx').innerHTML = '<b>Väder saknas</b>kunde inte hämtas'; }
}
function wxVerdict(i){ const h = wx, cc = h.cloud_cover[i], pr = h.precipitation[i], vis = h.visibility ? h.visibility[i] : 20000, ws = h.wind_speed_10m[i];
  if (pr > 0.4) return ['🌧️', 'Regn – svårt att filma ute']; if (vis != null && vis < 2000) return ['🌫️', 'Dimma – stämningsfullt men kort sikt'];
  let v = cc < 25 ? ['☀️', 'Klart – fint ljus'] : cc < 70 ? ['⛅', 'Växlande moln – dramatisk himmel'] : ['☁️', 'Mulet – mjukt, platt ljus'];
  if (ws > 35) v = [v[0], v[1] + ', blåsigt (drönare?)']; return v; }
function renderWeather(){ if (!wx) return;
  const now = Date.now(); let i = wx.time.findIndex(t => new Date(t).getTime() > now - 3600e3); if (i < 0) i = 0;
  const [ico, txt] = wxVerdict(i); const temp = Math.round(wx.temperature_2m[i]);
  const later = [2, 4].map(k => wx.time[i + k] ? wx.time[i + k].slice(11, 16) + ' ' + wxVerdict(i + k)[0] : '').join(' · ');
  $('wx').innerHTML = `<b>${ico} ${esc(txt)}</b>${temp}° · moln ${wx.cloud_cover[i]}% · ${esc(later)}`; }

/* ---------- Ljus ---------- */
function renderLight(){
  if (!pos) return; const L = lightPhase(pos.lat, pos.lon, new Date());
  $('banner').className = 'banner ' + L.cls; $('bIco').textContent = L.ico; $('bBig').textContent = L.big;
  $('bSub').textContent = L.sub + ' Sol nu: ' + Math.round(L.pos.altitude) + '° över horisonten, i ' + compass(L.pos.azimuth) + '.';
  $('tSun').textContent = '↑' + fmtT(L.t.sunrise) + ' ↓' + fmtT(L.t.sunset);
}
function backlit(s, from){ // from: {lat,lon} – betraktarens position
  const p = SUN.position(new Date(), s.lat, s.lon); if (p.altitude < -2) return null;
  let look, how;
  if (s.dir != null && s.type === 'viewpoint'){ look = s.dir; how = 'Utsikten'; }
  else if (from){ look = bearing(from.lat, from.lon, s.lat, s.lon); how = 'Filmar du mot platsen härifrån'; } else return null;
  const d = Math.abs(angDiff(look, p.azimuth));
  if (d < 50) return {bad: true, txt: how + ' är det motljus (solen i ' + compass(p.azimuth) + ').'};
  if (d > 120) return {bad: false, txt: how + ' har du solen i ryggen – fint frontljus.'};
  return {bad: false, txt: how + ' får du sidoljus – ger djup och struktur.'};
}
function tipFor(s){
  const t = SUN.times(new Date(), s.lat, s.lon), setAz = valid(t.sunset) ? SUN.position(t.sunset, s.lat, s.lon).azimuth : 270,
    riseAz = valid(t.sunrise) ? SUN.position(t.sunrise, s.lat, s.lon).azimuth : 90;
  const sets = 'solen går ner i ' + compass(setAz), rises = 'solen går upp i ' + compass(riseAz);
  switch (s.type){
    case 'viewpoint': if (s.dir != null){ const ev = Math.abs(angDiff(s.dir, setAz)) < 70, mo = Math.abs(angDiff(s.dir, riseAz)) < 70;
        return 'Utsikten vetter mot ' + compass(s.dir) + ' – ' + (ev ? 'solnedgång i bild, bäst i kvällsljus.' : mo ? 'soluppgång i bild, bäst tidigt på morgonen.' : 'bäst i kvälls- eller morgonljus från sidan.'); }
      return 'Utsiktsplats – bäst i kvällsljus, ' + sets + '. Prova en långsam panorering eller timelapse.';
    case 'peak': return 'Topp' + (s.ele ? ' (' + s.ele + ' m ö.h.)' : '') + ' – vida vyer, ' + sets + '. Gyllene timmen ger långa skuggor i landskapet.';
    case 'lighthouse': return 'Fyr – snyggast under blå timmen när ljuset tänds. ' + sets[0].toUpperCase() + sets.slice(1) + '.';
    case 'waterfall': return 'Vattenfall – filma i mjukt ljus eller mulet väder; ND-filter för slöjigt vatten.';
    case 'castle': case 'fort': case 'ruins': return TYPES[s.type].name + ' – dramatiskt i lågt sidoljus; ' + rises + ', ' + sets + '. Drönarvy kräver ofta tillstånd.';
    case 'bridge': return 'Bro – passa på att filma bilen i rörelse över bron. Blå timmen med upplysta brospann blir fint.';
    case 'beach': return 'Strand – ' + sets + '; motljus i vattnet kring solnedgång ger glitter.';
    default: return 'Sevärdhet – kolla bilderna nedan för vinklar som andra hittat.';
  }
}

/* ---------- Rendering ---------- */
function relInfo(s){
  if (!pos) return {d: 0, txt: ''};
  const d = dist(pos.lat, pos.lon, s.lat, s.lon), b = bearing(pos.lat, pos.lon, s.lat, s.lon);
  const dir = heading != null && (kmh == null || kmh > 3) ? relDir(angDiff(b, heading)) : 'åt ' + compass(b);
  return {d, b, txt: fmtKm(d) + ', ' + dir}; }
function spotName(s){ return s.name || TYPES[s.type].name; }
function ranked(){ return spots.filter(s => !pos || dist(pos.lat, pos.lon, s.lat, s.lon) <= S.radius * 1000 * 1.15).sort((a, b) => score(b) - score(a)); }
function render(){
  renderMap();
  const L = $('list');
  if (tab === 'photos'){ renderPhotosHere(); return; }
  let arr = tab === 'fav' ? Object.values(fav) : ranked().slice(0, 60);
  if (tab === 'fav') arr.sort((a, b) => pos ? dist(pos.lat, pos.lon, a.lat, a.lon) - dist(pos.lat, pos.lon, b.lat, b.lon) : 0);
  if (!arr.length){ L.innerHTML = '<div class="empty">' + (tab === 'fav' ? 'Inga favoriter än. Öppna en plats och tryck ★.' : !pos ? 'Ingen position än.' : querying ? 'Söker…' : 'Inga fina platser hittades inom ' + S.radius + ' km. Prova en större radie.') + '</div>'; return; }
  L.innerHTML = arr.map((s, i) => { const r = relInfo(s), T = TYPES[s.type];
    const flags = (fav[s.key] ? '★ ' : '') + (seen[s.key] ? '✓ besökt · ' : '') + T.name + (s.wiki ? ' · Wikipedia' : '') + (s.ele ? ' · ' + s.ele + ' m' : '');
    return `<button class="item${seen[s.key] ? ' seen' : ''}" data-k="${esc(s.key)}"><div class="ii" id="th_${esc(s.key)}">${T.ico}</div><div style="min-width:0"><b>${esc(spotName(s))}</b><small>${esc(flags)}</small></div><div class="when">${esc(fmtKm(r.d))}<small>${esc(r.txt.split(', ')[1] || '')}</small></div></button>`; }).join('');
  arr.slice(0, 14).forEach(s => loadThumb(s));
}
function loadThumb(s){
  commons(s.lat, s.lon, 250, 3).then(ph => { const el = document.getElementById('th_' + s.key); if (el && ph[0]) el.style.backgroundImage = 'url("' + ph[0].thumb + '")'; s.hasPh = ph.length; }).catch(() => {});
}
function photoHTML(ph){ return '<div class="pgrid">' + ph.map(p => `<a class="ph" href="${esc(p.page)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(p.thumb)}" alt="${esc(p.title)}"><span>📷 ${esc(p.author)}${p.lic ? ' · ' + esc(p.lic) : ''}</span><span>${esc(fmtKm(p.d))} bort · Wikimedia Commons</span></a>`).join('') + '</div>'; }
let photosToken = 0;
async function renderPhotosHere(){
  const L = $('list'); if (!pos){ L.innerHTML = '<div class="empty">Ingen position än.</div>'; return; }
  const tk = ++photosToken; L.innerHTML = '<div class="empty">Hämtar foton tagna nära bilen…</div>';
  try { const ph = await commons(pos.lat, pos.lon, Math.min(10000, S.radius * 1000), 24); if (tk !== photosToken || tab !== 'photos') return;
    L.innerHTML = ph.length ? '<div class="empty" style="padding:.6em .2em">Foton som andra tagit inom ' + Math.min(10, S.radius) + ' km – tryck för att öppna på Commons.</div>' + photoHTML(ph) : '<div class="empty">Inga geotaggade foton på Commons här.</div>'; }
  catch(e){ if (tk === photosToken) L.innerHTML = '<div class="empty">Kunde inte hämta foton från Wikimedia Commons just nu.</div>'; }
}

/* ---------- Detaljvy ---------- */
let openSpot = null;
function openDetail(s){
  openSpot = s; const T = TYPES[s.type], r = relInfo(s), t = SUN.times(new Date(), s.lat, s.lon), sp = SUN.position(new Date(), s.lat, s.lon), bl = backlit(s, pos);
  const ll = s.lat.toFixed(5) + ', ' + s.lon.toFixed(5);
  const wp = s.tags.wikipedia ? s.tags.wikipedia.split(':') : null;
  const links = [`<a href="https://www.openstreetmap.org/${s.osm}" target="_blank" rel="noopener">OpenStreetMap</a>`];
  if (wp) links.push(`<a href="https://${esc(wp[0])}.wikipedia.org/wiki/${encodeURIComponent(wp.slice(1).join(':'))}" target="_blank" rel="noopener">Wikipedia</a>`);
  $('spotSheet').innerHTML = `
   <div class="kicker">${T.ico} ${esc(T.name)}${s.ele ? ' · ' + esc(s.ele) + ' m ö.h.' : ''}</div>
   <h2>${esc(spotName(s))}</h2>
   <div class="meta"><b>${esc(r.txt)}</b> · ${links.join(' · ')}</div>
   <div class="tip">💡 ${esc(tipFor(s))}${bl ? '<br>' + (bl.bad ? '⚠️ ' : '👍 ') + esc(bl.txt) : ''}</div>
   <div class="suntab">
    <div>Blå timmen (morgon)<b>${fmtT(t.blueStartAM)}–${fmtT(t.blueEndAM)}</b></div>
    <div>Gyllene timmen (morgon)<b>${fmtT(t.goldStartAM)}–${fmtT(t.goldEndAM)}</b></div>
    <div>Gyllene timmen (kväll)<b>${fmtT(t.goldStartPM)}–${fmtT(t.goldEndPM)}</b></div>
    <div>Blå timmen (kväll)<b>${fmtT(t.blueStartPM)}–${fmtT(t.blueEndPM)}</b></div>
    <div>Soluppgång<b>${fmtT(t.sunrise)}</b></div><div>Solnedgång<b>${fmtT(t.sunset)}</b></div>
    <div>Solen nu<b>${Math.round(sp.altitude)}° · ${COMP_SHORT[Math.round(sp.azimuth / 45) % 8]} ${Math.round(sp.azimuth)}°</b></div>
    <div>Koordinater<b class="coords">${ll}</b></div>
   </div>
   <div class="btnrow">
    <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}&travelmode=driving" target="_blank" rel="noopener">🧭 Navigera dit</a>
    <button class="btn" id="dCopy">📋 Kopiera koordinater</button>
    <button class="btn${fav[s.key] ? ' on' : ''}" id="dFav">${fav[s.key] ? '★ Favorit' : '☆ Favorit'}</button>
    <button class="btn${seen[s.key] ? ' on' : ''}" id="dSeen">${seen[s.key] ? '✓ Besökt' : 'Markera besökt'}</button>
    <button class="btn" id="dClose">Stäng</button>
   </div>
   <h3>Foton från platsen (Wikimedia Commons)</h3><div id="dPh" class="empty">Hämtar foton…</div>`;
  $('ovSpot').classList.add('show');
  $('dClose').onclick = closeDetail;
  $('dCopy').onclick = () => copyText(ll);
  $('dFav').onclick = () => { if (fav[s.key]) delete fav[s.key]; else fav[s.key] = slim(s); LS.set('fav', fav); openDetail(s); render(); };
  $('dSeen').onclick = () => { if (seen[s.key]) delete seen[s.key]; else seen[s.key] = Date.now(); LS.set('seen', seen); openDetail(s); render(); };
  commons(s.lat, s.lon, 600, 12).then(ph => { if (openSpot !== s) return; const el = $('dPh'); if (!el) return; el.className = '';
    el.innerHTML = ph.length ? photoHTML(ph) : '<div class="empty">Inga geotaggade foton på Commons inom 600 m. Bli först! 🎬</div>'; })
    .catch(() => { const el = $('dPh'); if (el) el.textContent = 'Kunde inte hämta foton just nu.'; });
}
const slim = s => ({key: s.key, osm: s.osm, lat: s.lat, lon: s.lon, type: s.type, name: s.name, tags: {wikipedia: s.tags.wikipedia, wikidata: s.tags.wikidata, ele: s.tags.ele, direction: s.tags.direction, height: s.tags.height, 'seamark:type': s.tags['seamark:type']}, wiki: s.wiki, img: s.img, ele: s.ele, dir: s.dir});
function closeDetail(){ $('ovSpot').classList.remove('show'); openSpot = null; }
function copyText(t){
  const done = () => showMsg('Koordinaterna ' + esc(t) + ' kopierade.', 'info', 2500);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done)); else fallbackCopy(t, done); }
function fallbackCopy(t, done){ const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch(e){ showMsg('Kopiera för hand: ' + esc(t), 'info', 6000); } ta.remove(); }

/* OSM-kartrutor: måste skicka Referer (OSM:s policy). Sidan blockerar annars Referer för Google-rösten,
   så vi slår på den per kartlager. Vid upprepade fel byts till CARTO som reserv. */
function addBaseMap(map){
  const OSM = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsgivare'});
  const CARTO = () => L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom: 19, subdomains: 'abcd', referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsgivare © <a href="https://carto.com/attributions">CARTO</a>'});
  let ok = 0, bad = 0, switched = false;
  OSM.on('tileload', () => { ok++; });
  OSM.on('tileerror', () => { bad++;
    if (!switched && bad >= 4 && ok === 0){ switched = true; map.removeLayer(OSM); CARTO().addTo(map); window.__mapProvider = 'carto'; }
  });
  window.__mapProvider = 'osm';
  OSM.addTo(map); return OSM;
}

/* ---------- Karta ---------- */
let map = null, carMk = null, layer = null, follow = true;
function initMap(){
  if (!window.L){ $('mapmsg').textContent = 'Kartan kunde inte laddas (ingen uppkoppling?). Listan fungerar ändå.'; return; }
  try {
    map = L.map('map', {zoomControl: false, attributionControl: true}).setView([58.07, 11.82], 11);
    addBaseMap(map);
    layer = L.layerGroup().addTo(map); $('mapmsg').style.display = 'none';
    map.on('dragstart', () => { follow = false; });
  } catch(e){ map = null; $('mapmsg').textContent = 'Kartan kunde inte startas.'; }
}
let lastMapSig = '';
function renderMap(){
  if (!map) return;
  if (pos){
    const icon = L.divIcon({className: '', html: '<div class="car" style="transform:rotate(' + (heading || 0) + 'deg)">' + (heading != null ? '<i></i>' : '') + '</div>', iconSize: [26, 26], iconAnchor: [13, 13]});
    if (!carMk) carMk = L.marker([pos.lat, pos.lon], {icon, zIndexOffset: 1000, interactive: false}).addTo(map); else { carMk.setLatLng([pos.lat, pos.lon]); carMk.setIcon(icon); }
    if (follow) map.setView([pos.lat, pos.lon], map.getZoom() < 9 ? 12 : map.getZoom(), {animate: false});
  }
  const arr = ranked().slice(0, 60), sig = arr.map(s => s.key + (fav[s.key] ? 'f' : '') + (seen[s.key] ? 's' : '')).join();
  if (sig === lastMapSig) return; lastMapSig = sig; layer.clearLayers();
  arr.forEach(s => { const m = L.marker([s.lat, s.lon], {icon: L.divIcon({className: '', html: '<div class="mk' + (fav[s.key] ? ' fav' : '') + (seen[s.key] ? ' seen' : '') + '">' + TYPES[s.type].ico + '</div>', iconSize: [32, 32], iconAnchor: [16, 16]})});
    m.on('click', () => openDetail(s)); m.addTo(layer); });
}

/* ---------- Position ---------- */
let demo = null, gpsWatch = null, lastFix = null;
function setGps(st, txt){ $('dGps').className = 'dot ' + (st || ''); $('tGps').textContent = txt; }
function onPosition(lat, lon, speedMs, hdg){
  const now = Date.now();
  if (lastFix){ const d = dist(lastFix.lat, lastFix.lon, lat, lon); if (hdg == null && d > 15) hdg = bearing(lastFix.lat, lastFix.lon, lat, lon); }
  if (hdg != null && !isNaN(hdg)) heading = hdg;
  kmh = speedMs != null && !isNaN(speedMs) ? speedMs * 3.6 : kmh;
  if (!lastFix || dist(lastFix.lat, lastFix.lon, lat, lon) > 15) lastFix = {lat, lon, t: now};
  pos = {lat, lon};
  refreshSpots(); refreshWeather(); renderLight();
  if (tab !== 'photos') renderThrottled(); else renderMap();
}
let lastRender = 0; function renderThrottled(){ if (Date.now() - lastRender > 2500){ lastRender = Date.now(); render(); } }
function startGps(){
  stopDemo(); $('ovStart').classList.remove('show');
  if (!('geolocation' in navigator)){ showMsg('Webbläsaren saknar positionering. Prova demoläget.'); return; }
  setGps('warn', 'GPS: söker…'); $('bStart').classList.add('on'); $('bStart').textContent = '■ Stoppa GPS';
  gpsWatch = navigator.geolocation.watchPosition(p => { setGps(p.coords.accuracy > 150 ? 'warn' : 'ok', 'GPS: ±' + Math.round(p.coords.accuracy) + ' m');
    onPosition(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.heading); },
    e => { setGps('err', 'GPS: fel'); showMsg(e.code === 1 ? 'Positionering nekad. Tillåt plats för sidan i webbläsaren, eller prova demoläget.' : 'Ingen GPS-position just nu. Försöker igen…', 'info', 6000); },
    {enableHighAccuracy: true, maximumAge: 5000, timeout: 30000});
  keepAwake();
}
function stopGps(){ if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; $('bStart').classList.remove('on'); $('bStart').textContent = '▶ Starta GPS'; setGps('', 'GPS: av'); }
function startDemo(key, startFrac){
  stopGps(); stopDemo(); $('ovStart').classList.remove('show');
  const r = ROUTES[key], pts = r.pts, seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++){ const d = dist(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]); seg.push(d); tot += d; }
  demo = {key, s: tot * (startFrac || 0), tot, seg, pts, speed: r.speed, tempo: S.tempo || 5, timer: null};
  $('chipDemo').style.display = ''; $('chipDemo').textContent = 'DEMO · ' + r.name.split(':')[0];
  $('bDemo').textContent = 'Stoppa demo'; $('bDemo').classList.add('on'); setGps('ok', 'GPS: demo'); follow = true;
  const step = () => { if (!demo) return;
    demo.s += demo.speed / 3.6 * demo.tempo;
    if (demo.s >= demo.tot){ showMsg('Demoturen är slut. 🏁', 'info', 4000); stopDemo(); return; }
    let s = demo.s, i = 0; while (i < seg.length && s > seg[i]){ s -= seg[i]; i++; }
    const a = pts[i], b = pts[i+1] || a, f = seg[i] ? s / seg[i] : 0;
    onPosition(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, demo.speed / 3.6, bearing(a[0], a[1], b[0], b[1])); };
  step(); demo.timer = setInterval(step, 1000); keepAwake();
}
function stopDemo(){ if (!demo) return; clearInterval(demo.timer); demo = null; $('chipDemo').style.display = 'none'; $('bDemo').textContent = 'Demo'; $('bDemo').classList.remove('on'); setGps('', 'GPS: av'); }

let wakeLock = null;
async function keepAwake(){ try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock){ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch(e){ /* ej tillåtet – ok */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (demo || gpsWatch != null)) keepAwake(); });

/* ---------- Meddelanden ---------- */
let msgT = null;
function showMsg(html, kind, ms){ const m = $('msg'); m.className = kind || ''; m.innerHTML = html; m.style.display = 'block'; clearTimeout(msgT); msgT = setTimeout(() => { m.style.display = 'none'; }, ms || 5000); }
$('msg').onclick = () => { $('msg').style.display = 'none'; };
window.addEventListener('error', e => console.warn('Fel:', e.message));
window.addEventListener('unhandledrejection', e => { console.warn('Ohanterat:', e.reason); e.preventDefault(); });

/* ---------- UI ---------- */
function setRadius(r){ S.radius = r; LS.set('settings', S); document.querySelectorAll('#segR button').forEach(b => b.classList.toggle('sel', +b.dataset.r === r)); lastMapSig = ''; refreshSpots(true); render(); }
document.querySelectorAll('#segR button').forEach(b => b.onclick = () => setRadius(+b.dataset.r));
document.querySelectorAll('#segR button').forEach(b => b.classList.toggle('sel', +b.dataset.r === S.radius));
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.t; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('sel', x === b)); render(); });
$('list').addEventListener('click', e => { const it = e.target.closest('.item'); if (!it) return; const k = it.dataset.k; const s = spots.find(x => x.key === k) || fav[k]; if (s) openDetail(s); });
$('bStart').onclick = () => gpsWatch != null ? stopGps() : startGps();
$('sGps').onclick = startGps;
$('bDemo').onclick = () => demo ? stopDemo() : $('ovStart').classList.add('show');
$('bRefresh').onclick = () => { follow = true; refreshSpots(true); refreshWeather(true); render(); };
$('ovSpot').addEventListener('click', e => { if (e.target.id === 'ovSpot') closeDetail(); });
$('ovStart').addEventListener('click', e => { if (e.target.id === 'ovStart' && (pos || demo)) $('ovStart').classList.remove('show'); });
$('demoBtns').innerHTML = Object.entries(ROUTES).map(([k, r]) => `<button class="btn" data-demo="${k}">🎬 Demo: ${esc(r.name)}</button>`).join('');
$('demoBtns').querySelectorAll('button').forEach(b => b.onclick = () => startDemo(b.dataset.demo));
setInterval(() => { renderLight(); if (wx) renderWeather(); }, 30000);
initMap();
// ?demo=kust|alp|rhen startar demo direkt (för test), &at=0.3 = startpunkt längs rutten
(() => { const q = new URLSearchParams(location.search); if (q.get('demo') && ROUTES[q.get('demo')]) startDemo(q.get('demo'), +(q.get('at') || 0)); })();
