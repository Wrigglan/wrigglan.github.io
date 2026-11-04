'use strict';
const WB = '(?:^|$|(?<=[^\\p{L}\\p{N}])|(?=[^\\p{L}\\p{N}]))';
const U = src => new RegExp(src.replace(/\\b/g, WB), 'iu');
/* Reseguide – berättar om platser du passerar. Data: Wikipedia (CC BY-SA). */
const $ = id => document.getElementById(id);
const LS = {
  get(k, d){ try{ const v = localStorage.getItem('rg_'+k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('rg_'+k, JSON.stringify(v)); }catch(e){} }
};
const S = Object.assign({lang:'sv', talk:'normal', engine:'auto', mem:7, map:1, tempo:3}, LS.get('settings', {}));
const saveS = () => LS.set('settings', S);
const TALK = { lite:{gap:180, min:3.2}, normal:{gap:90, min:1.8}, mycket:{gap:50, min:0.9} };

/* ---------- Geo ---------- */
const R_E = 6371000, rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
function dist(a, b, c, d){ const p1=rad(a), p2=rad(c), dp=rad(c-a), dl=rad(d-b);
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return 2*R_E*Math.asin(Math.min(1, Math.sqrt(h))); }
function bearing(a, b, c, d){ const p1=rad(a), p2=rad(c), dl=rad(d-b);
  const y = Math.sin(dl)*Math.cos(p2), x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl); return (deg(Math.atan2(y, x))+360)%360; }
function project(lat, lon, brg, m){ const dr = m/R_E, t = rad(brg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1)*Math.cos(dr) + Math.cos(p1)*Math.sin(dr)*Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t)*Math.sin(dr)*Math.cos(p1), Math.cos(dr) - Math.sin(p1)*Math.sin(p2)); return [deg(p2), deg(l2)]; }
const angDiff = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d; }; // -180..180, + = höger
function radiusFor(kmh){ return kmh < 25 ? 2000 : kmh < 60 ? 3500 : kmh < 90 ? 6000 : 9000; }

/* ---------- Text ---------- */
const fmtKm = (m, lang) => { const km = m/1000; const v = km < 10 ? km.toFixed(1) : Math.round(km).toString(); return lang === 'sv' ? v.replace('.', ',') : v; };
function relDir(rel, lang){ // rel: -180..180
  const a = Math.abs(rel), right = rel > 0;
  if (lang === 'sv'){
    if (a <= 25) return 'rakt fram'; if (a <= 65) return right ? 'snett framåt höger' : 'snett framåt vänster';
    if (a <= 125) return right ? 'till höger' : 'till vänster'; return right ? 'bakom, till höger' : 'bakom, till vänster';
  }
  if (a <= 25) return 'straight ahead'; if (a <= 65) return right ? 'ahead on the right' : 'ahead on the left';
  if (a <= 125) return right ? 'on your right' : 'on your left'; return right ? 'behind you, right' : 'behind you, left';
}
const COMP_SV = ['norr','nordost','öster','sydost','söder','sydväst','väster','nordväst'], COMP_EN = ['north','north-east','east','south-east','south','south-west','west','north-west'];
function compass(b, lang){ const i = Math.round(b/45) % 8; return lang === 'sv' ? 'åt ' + COMP_SV[i] : 'to the ' + COMP_EN[i]; }
function dirInfo(p, lang){
  if (!pos) return {d:0, txt:''};
  const d = dist(pos.lat, pos.lon, p.lat, p.lon), b = bearing(pos.lat, pos.lon, p.lat, p.lon);
  let dir = (heading != null && pos.kmh > 8) ? relDir(angDiff(heading, b), lang) : compass(b, lang);
  if (d < 600) return {d, txt: lang === 'sv' ? 'alldeles intill' : 'right here', short:true};
  return {d, txt: fmtKm(d, lang) + ' km ' + dir, dir};
}
const ABBR0 = /(?:\b(?:ca|bl\.a|t\.ex|d\.v\.s|dvs|m\.m|s\.k|resp|st|sankt|dr|mr|mrs|nr|kap|f|d|e\.kr|f\.kr|osv|jfr|etc|vol|jh|z\.b|u\.a|ev|inkl|ung|kvm|km|m\.ö\.h|mt|no|approx|c|vs|ca|bzw|n\.chr|v\.chr|evtl|ggf|hl|st\.?|ss|e\.g|i\.e))\.$|\b[A-ZÅÄÖ]\.$|\d\.$/i;
const ABBR = U(ABBR0.source);
function cleanText(t){
  if (!t) return '';
  let s = t.replace(/\[[^\]]*\]/g, '');
  for (let i = 0; i < 3; i++) s = s.replace(/\s*\([^()]*\)/g, '');
  s = s.replace(/\s*[;,]\s*[;,]/g, ',').replace(/\s+([,.;:])/g, '$1').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return s;
}
function sentences(t){
  const parts = t.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=["«„]?[A-ZÅÄÖÜÉ0-9])/);
  const out = [];
  for (const p of parts){ if (out.length && ABBR.test(out[out.length-1]) && !/\d{4}\.$/.test(out[out.length-1])) out[out.length-1] += ' ' + p; else out.push(p); }
  return out.map(x => x.trim()).filter(x => x.length > 1);
}
function shortText(extract){
  const ss = sentences(cleanText(extract)); let out = '', n = 0;
  for (const s of ss){ if (n >= 3) break; if (n >= 2 && (out + s).length > 420) break; if (n >= 1 && (out + s).length > 520) break; out += (out ? ' ' : '') + s; n++; }
  if (out.length > 600) out = out.slice(0, 580).replace(/\s+\S*$/, '') + ' …';
  return {text: out, used: n, all: ss};
}

/* ---------- Wikipedia ---------- */
const LOCAL_LANG = {SE:'sv', NO:'no', DK:'da', FI:'fi', DE:'de', AT:'de', CH:'de', LI:'de', FR:'fr', BE:'fr', LU:'fr', MC:'fr', NL:'nl', IT:'it', SM:'it', ES:'es', PT:'pt', PL:'pl', CZ:'cs', SK:'sk', HU:'hu', SI:'sl', HR:'hr', EE:'et', LV:'lv', LT:'lt', IS:'is', GR:'el', IE:'en', GB:'en', RO:'ro', BG:'bg', RS:'sr', BA:'bs', ME:'sr', AL:'sq', MK:'mk'};
const VOICE_LANG = {sv:'sv-SE', en:'en-GB', de:'de-DE', no:'nb-NO', da:'da-DK', fi:'fi-FI', fr:'fr-FR', nl:'nl-NL', it:'it-IT', es:'es-ES', pt:'pt-PT', pl:'pl-PL', cs:'cs-CZ'};
const LANG_NAME = {sv:'svenska', en:'engelska', de:'tyska', no:'norska', da:'danska', fi:'finska', fr:'franska', nl:'nederländska', it:'italienska', es:'spanska', pt:'portugisiska', pl:'polska', cs:'tjeckiska'};
let apiChain = Promise.resolve(), apiCount = 0, apiErrors = 0;
function api(lang, params){
  const q = new URLSearchParams(Object.assign({format:'json', formatversion:'2', origin:'*'}, params));
  const url = `https://${lang}.wikipedia.org/w/api.php?${q}`;
  // en förfrågan i taget, med liten paus – snällt mot Wikipedia
  const run = async () => {
    const ctl = 'AbortController' in window ? new AbortController() : null; const to = setTimeout(() => ctl && ctl.abort(), 12000);
    try { apiCount++; const r = await fetch(url, ctl ? {signal: ctl.signal} : {}); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); apiErrors = 0; return j; }
    finally { clearTimeout(to); await new Promise(r => setTimeout(r, 150)); }
  };
  const p = apiChain.then(run, run); apiChain = p.catch(() => {}); return p;
}
// Titlar/beskrivningar som är trivia: gator, hållplatser, företag, administrativa enheter …
const BAD = U(String.raw`(\bgata\b|\bgatan\b|\bväg i\b|\bvägen\b|hållplats|busstation|företag|aktiebolag|\bskola\b|förskola|gymnasi|församling|\bsocken\b|\bdistrikt\b|landskommun|tingslag|\bhärad\b|valkrets|kvarter|fastighet|bostadsområde|villaområde|hotell|restaurang|\bbutik|köpcentrum|bensinstation|trafikplats|motorvägskorsning|trafikled|\bkommunblock|landsförsamling|pastorat|kontrakt\b|stadsdelsnämnd|\bstreet\b|\broad in\b|bus stop|\bcompany\b|\bschool\b|\bparish\b|electoral|neighbourhood|shopping|\bhotel\b|restaurant|interchange|\bstraße\b|\bstrasse\b|bushaltestelle|unternehmen|\bschule\b|pfarrei|verbandsgemeinde|wahlkreis|gemarkung|\bkreisstraße|bundesstraße|landesstraße|autobahn|\bmotorway\b|\bmotorväg\b|\bspårväg|tunnelbana|sporthall|idrottsplats|arena\b|fotbollsklubb|football club|\bbank\b|\bstation\b|\bbahnhof|haltepunkt|railway station|järnvägsstation|reningsverk|kraftledning|transformator|vattentorn|industriområde|gewerbegebiet|\bmord\b|mordet|murder|olycka|olyckan|accident|massaker|massacre|attentat|shooting|skottlossning|disaster|katastrof|\bfödd\b|\bborn\b|politiker|politician|footballer|fotbollsspelare|musikgrupp|\balbum\b|\bfilm\b|tv-serie|incident|händelse|\bslaget vid\b|hockeyklubb|idrottsförening|sports club|\bverein\b|assault on|siege of|belägring|\bslaget\b|battle of|treaty|fördraget|\bfreden i\b)`);
const CATS = [
  {k:'castle', w:3.0, l:'Slott & borgar', i:'🏰', re:U(String.raw`(slott\b|slottet|\bborg\b|borgen\b|borgruin|fästning|kastell|castle|fortress|\bburg\b|^burg |schloss|festung|château|ruine)`)},
  {k:'ancient', w:2.4, l:'Historisk plats', i:'🗿', re:U(String.raw`(fornborg|fornlämning|runsten|hällristning|gravfält|gravhög|domarring|stenålder|bronsålder|järnålder|vikinga|ruin\b|ruiner|archaeolog|hillfort|runestone|burial|roman fort|römisch|limes|slagfält)`)},
  {k:'church', w:2.1, l:'Kyrka', i:'⛪', re:U(String.raw`(kyrka\b|kyrkan\b|kyrkobyggnad|domkyrka|kloster|klostret|kapell|katedral|church|cathedral|abbey|monastery|kirche|\bdom\b|münster|basilika|kloster|stift\b)`)},
  {k:'sight', w:2.2, l:'Sevärdhet', i:'⭐', re:U(String.raw`(museum|museet|sevärdhet|monument|minnesmärke|utsikt|\bfyr\b|fyren|fyrplats|lighthouse|viewpoint|denkmal|aussicht|unesco|världsarv|world heritage|herrgård|säteri|manor|park\b|trädgård|zoo|djurpark|nöjespark)`)},
  {k:'nature', w:2.0, l:'Natur', i:'🌲', re:U(String.raw`(naturreservat|nationalpark|vattenfall|national park|nature reserve|waterfall|naturschutz|naturpark|grotta|cave|höhle)`)},
  {k:'mountain', w:1.9, l:'Berg', i:'⛰️', re:U(String.raw`(\bberg i\b|\bberg\b.*\bmeter|fjäll|klippa|kulle|mountain|\bhill\b|\bpeak\b|felsen|gipfel|\bmassiv)`)},
  {k:'bridge', w:1.7, l:'Bro', i:'🌉', re:U(String.raw`(\bbro\b|\bbron\b|bridge|brücke|viadukt)`)},
  {k:'island', w:1.5, l:'Ö', i:'🏝️', re:U(String.raw`(\bö i\b|\bön\b|ögrupp|island|\binsel\b|\bisle\b)`)},
  {k:'water', w:1.0, l:'Sjö & vatten', i:'🌊', re:U(String.raw`(insjö|\bsjö\b|\bälv\b|\bå i\b|fjord|\bvik\b|\blake\b|river|\bsee\b|\bfluss\b|vattendrag)`)},
  {k:'town', w:1.7, l:'Ort', i:'🏘️', re:U(String.raw`(tätort|småort|\bstad\b|centralort|\bort i\b|\bby i\b|\btown\b|village|\bcity\b|\bstadt\b|\bgemeinde\b|\bdorf\b|ortschaft|ortsteil|stadsdel|municipality in|kommune\b|tettsted)`)},
  {k:'kommun', w:0.7, l:'Kommun', i:'🗺️', re:U(String.raw`(\bkommun\b|kommun i|municipality|landkreis|\bkreis\b)`)},
];
function categorize(p){
  const head = (p.title + ' — ' + (p.desc || '')).toLowerCase();
  const first = (p.extract || '').split(/(?<=\.)\s/)[0].slice(0, 220).toLowerCase();
  if (BAD.test(p.title) || BAD.test(p.desc || '')) return null;
  for (const c of CATS) if (c.re.test(head)) return c;
  if (p.gtype === 'city') return CATS.find(c => c.k === 'town');
  if (p.gtype === 'waterbody') return CATS.find(c => c.k === 'water');
  if (p.gtype === 'mountain') return CATS.find(c => c.k === 'mountain');
  if (p.gtype === 'isle') return CATS.find(c => c.k === 'island');
  if (p.gtype === 'railwaystation' || p.gtype === 'airport' || p.gtype === 'edu') return null;
  if (BAD.test(first)) return null;
  for (const c of CATS) if (c.re.test(first)) return Object.assign({}, c, {w: c.w * .85});
  return {k:'other', w:1.0, l:'Plats', i:'📍'};
}
function importance(p){
  const len = Math.log10((p.length || 500) + 100) - 2.2;              // ~0.5 (kort) … 2.4 (lång)
  const pv = p.pv ? 0.7 * Math.log10(p.pv + 1) : 0;                   // sidvisningar senaste 2 veckorna
  const low = (p.pv != null && p.pv < 10) ? 0.75 : 1; // nästan ingen läser artikeln -> troligen botartikel
  return Math.max(0.2, (len + pv + (p.thumb ? 0.3 : 0)) * low);
}

const pool = new Map();          // key -> plats
const geoCache = new Map();      // lang|grid -> lista
let details = LS.get('cache', {}); // lang:pageid -> detaljer (cache)
const saveCache = () => { const ks = Object.keys(details); if (ks.length > 600){ ks.sort((a,b) => details[a].ts - details[b].ts).slice(0, ks.length - 450).forEach(k => delete details[k]); } LS.set('cache', details); };
let country = null;

async function geosearch(lang, lat, lon){
  const ck = lang + '|' + lat.toFixed(2) + '|' + lon.toFixed(2);
  if (geoCache.has(ck)) return geoCache.get(ck);
  const j = await api(lang, {action:'query', list:'geosearch', gscoord: lat.toFixed(5)+'|'+lon.toFixed(5), gsradius:10000, gslimit:200, gsprop:'type|country|dim'});
  const out = ((j.query && j.query.geosearch) || []).map(g => ({key: lang+':'+g.pageid, lang, pageid:g.pageid, title:g.title, lat:g.lat, lon:g.lon, gtype:g.type, country:g.country}));
  geoCache.set(ck, out); return out;
}
async function fetchDetails(lang, ids){
  const need = ids.filter(id => !details[lang+':'+id]);
  for (let i = 0; i < need.length; i += 20){
    const chunk = need.slice(i, i + 20);
    const prm = {action:'query', pageids: chunk.join('|'), prop:'extracts|pageimages|pageprops|info|description|pageviews' + (lang !== S.lang ? '|langlinks' : ''),
      exintro:1, explaintext:1, exlimit:20, piprop:'thumbnail', pithumbsize:480, pilimit:20, ppprop:'wikibase_item|disambiguation', pvipdays:14};
    if (lang !== S.lang){ prm.lllang = S.lang; prm.lllimit = 'max'; }
    const j = await api(lang, prm);
    for (const p of ((j.query && j.query.pages) || [])){
      const pv = p.pageviews ? Object.values(p.pageviews).reduce((a, b) => a + (b || 0), 0) : null;
      details[lang+':'+p.pageid] = {ts: Date.now(), title:p.title, desc:p.description || '', extract:p.extract || '', length:p.length || 0, pv,
        thumb: p.thumbnail ? p.thumbnail.source : '', qid: p.pageprops && p.pageprops.wikibase_item || '', disamb: !!(p.pageprops && 'disambiguation' in p.pageprops),
        ll: p.langlinks && p.langlinks[0] ? p.langlinks[0].title : ''};
    }
  }
  saveCache();
}
function prelim(g){ // grov poäng utan detaljer
  if (BAD.test(g.title) || g.gtype === 'adm2nd' || g.gtype === 'adm3rd' || g.gtype === 'adm1st' || g.gtype === 'country') return 0;
  let w = 1; for (const c of CATS) if (c.re.test(g.title)) { w = c.w; break; }
  if (g.gtype === 'city') w = Math.max(w, 1.5); if (g.gtype === 'landmark') w *= 1.1; if (g.gtype === 'mountain') w = Math.max(w, 1.6);
  return w * geoFactor(g, true);
}
function geoFactor(p, wide){
  if (!pos) return 1;
  const d = dist(pos.lat, pos.lon, p.lat, p.lon), R = radiusFor(pos.kmh) * (wide ? 1.4 : 1);
  if (d > R) return 0;
  let f = 1 - 0.55 * (d / R);
  if (heading != null && pos.kmh > 8 && d > 700){
    const a = Math.abs(angDiff(heading, bearing(pos.lat, pos.lon, p.lat, p.lon)));
    f *= a <= 40 ? 1 : a <= 75 ? 0.85 : a <= 110 ? 0.55 : 0.08; // bakom bilen = redan passerat
  }
  return f;
}
const langF = p => p.lang === S.lang ? 1 : (p.lang === 'en' || p.lang === 'sv') ? 0.85 : 0.7; // föredra valt språk
function score(p){ if (!p.cat) return 0; return p.cat.w * importance(p) * geoFactor(p) * langF(p); }

let refreshing = false, lastQuery = null;
async function refresh(force){
  if (!pos || refreshing) return;
  const R = radiusFor(pos.kmh);
  let c = [pos.lat, pos.lon];
  if (heading != null && pos.kmh > 20) c = project(pos.lat, pos.lon, heading, Math.min(R * 0.5, 4000));
  if (!force && lastQuery && dist(lastQuery[0], lastQuery[1], c[0], c[1]) < 1000) return;
  refreshing = true; lastQuery = c;
  try {
    const primary = S.lang, second = S.lang === 'sv' ? 'en' : 'sv';
    let res = await geosearch(primary, c[0], c[1]);
    const cc = mode(res.map(r => r.country).filter(Boolean)); if (cc) country = cc;
    const good = r => prelim(r) > 0;
    let n = res.filter(good).length;
    if (n < 12 || (country && country !== 'SE' && primary === 'sv')){
      const r2 = await geosearch(second, c[0], c[1]); res = res.concat(r2);
      const cc2 = mode(r2.map(r => r.country).filter(Boolean)); if (!country && cc2) country = cc2; else if (cc2 && !cc) country = cc2;
    }
    const local = country && LOCAL_LANG[country];
    if (local && local !== primary && local !== second && res.filter(good).length < 40){ res = res.concat(await geosearch(local, c[0], c[1])); }
    for (const g of res) if (!pool.has(g.key)) pool.set(g.key, g);
    await enrich();
    setGps(gpsState(), null);
  } catch (e) {
    apiErrors++; console.warn('Wikipedia-fel', e);
    if (apiErrors >= 2) showMsg('Kan inte nå Wikipedia just nu (' + (e.message || e) + '). Försöker igen när du kört en bit.', 'info', 6000);
    lastQuery = null;
  } finally { refreshing = false; }
}
function mode(arr){ const m = {}; let best = null; for (const a of arr){ m[a] = (m[a] || 0) + 1; if (!best || m[a] > m[best]) best = a; } return best; }
async function enrich(){
  // hämta detaljer för de bästa kandidaterna i närheten
  const cands = [...pool.values()].filter(p => !p.det).map(p => [p, prelim(p)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
  const byLang = {}; for (const p of cands) (byLang[p.lang] = byLang[p.lang] || []).push(p.pageid);
  for (const l in byLang) await fetchDetails(l, byLang[l]);
  for (const p of cands){ const d = details[p.key]; if (!d) continue; Object.assign(p, d, {det:true}); p.cat = (d.disamb || d.extract.length < 60) ? null : categorize(p); }
  // dubbletter: samma Wikidata-objekt i flera språk -> behåll önskat språk
  const byQ = {};
  for (const p of pool.values()){ if (!p.det || !p.qid || !p.cat) continue; const o = byQ[p.qid];
    if (!o) byQ[p.qid] = p; else { const rank = x => x.lang === S.lang ? 0 : x.lang === 'en' ? 1 : 2; if (rank(p) < rank(o)){ o.cat = null; o.dup = true; byQ[p.qid] = p; } else { p.cat = null; p.dup = true; } } }
  // samma koordinat (t.ex. kyrka + församling) -> behåll den bästa
  const arr = [...pool.values()].filter(p => p.cat);
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++){
    const a = arr[i], b = arr[j]; if (!a.cat || !b.cat || a.lang !== b.lang) continue;
    if (Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lon - b.lon) < 0.0006){ if (a.cat.w * importance(a) >= b.cat.w * importance(b)) b.cat = null; else a.cat = null; }
  }
  updateMap(); if (tab === 'near') renderList();
}
// inte för många i minnet
function prunePool(){ if (!pos || pool.size < 1500) return; for (const [k, p] of pool) if (dist(pos.lat, pos.lon, p.lat, p.lon) > 40000) pool.delete(k); }

/* ---------- Minne ---------- */
let told = LS.get('told', {}), hist = LS.get('hist', []);
const tkey = p => p.qid || p.key;
function isTold(p){ const t = told[tkey(p)]; return t && (Date.now() - t) < S.mem * 86400000; }
function markTold(p){ told[tkey(p)] = Date.now(); const lim = Date.now() - 3650 * 86400000; for (const k in told) if (told[k] < lim) delete told[k]; LS.set('told', told); }
function addHist(p){
  hist = hist.filter(h => h.key !== p.key && (!p.qid || h.qid !== p.qid));
  hist.unshift({key:p.key, lang:p.lang, pageid:p.pageid, title:p.title, qid:p.qid, lat:p.lat, lon:p.lon, thumb:p.thumb, extract:p.extract, desc:p.desc, length:p.length, cat:p.cat && p.cat.k, t:Date.now()});
  hist = hist.slice(0, 40); LS.set('hist', hist); if (tab === 'hist') renderList();
}
const catByKey = k => CATS.find(c => c.k === k) || {k:'other', w:1, l:'Plats', i:'📍'};

/* ---------- Röst ----------
   Ordning (Automatisk): 1) webbläsarens talsyntes om en fungerande svensk röst finns,
   2) lokal svensk AI-röst (Piper, körs i webbläsaren via WebAssembly – laddas ner en gång och cachas),
   3) online-röst (Google, inofficiell) som sista utväg, 4) endast text. */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
function pcmToWav(f, sr){ const n = f.length, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++){ const s = Math.max(-1, Math.min(1, f[i])); b.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Blob([b.buffer], {type: 'audio/wav'}); }

// Uppspelning: EN AudioContext som låses upp vid första trycket (samma teknik som Motorljud använder),
// med ett beständigt <audio>-element som reserv. Återupptas automatiskt när sidan blir synlig igen.
const Player = {
  ctx: null, src: null, el: null, endCb: null,
  unlock(){ // måste anropas i ett tryck
    try { const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !this.ctx){ this.ctx = new AC(); this.ctx.onstatechange = () => { if (this.ctx.state !== 'running' && document.visibilityState === 'visible') this.ctx.resume().catch(() => {}); }; }
      if (this.ctx){ this.ctx.resume().catch(() => {}); const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); }
    } catch (e) { console.warn('AudioContext', e); }
    try { if (!this.el){ this.el = new Audio(); this.el.preload = 'auto'; }
      if (this.el.paused){ this.el.src = SILENT; const pr = this.el.play(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) {}
  },
  async ready(){ if (!this.ctx) return false; if (this.ctx.state !== 'running'){ try { await Promise.race([this.ctx.resume(), new Promise(r => setTimeout(r, 800))]); } catch (e) {} } return this.ctx.state === 'running'; },
  // spelar PCM; löser när ljudet är slut (eller avbrutet)
  async play(pcm, sr){
    this.stop();
    if (await this.ready()){
      return new Promise(res => { const buf = this.ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel ? buf.copyToChannel(pcm, 0) : buf.getChannelData(0).set(pcm);
        const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.ctx.destination); this.src = s; this.endCb = res;
        const wd = setTimeout(() => this._end(s), pcm.length / sr * 1000 + 3000); // vakthund
        s.onended = () => { clearTimeout(wd); this._end(s); }; s.start(); });
    }
    // reserv: <audio> med WAV-blob
    const a = this.el || (this.el = new Audio()), url = URL.createObjectURL(pcmToWav(pcm, sr));
    return new Promise((res, rej) => { let done = false; const fin = err => { if (done) return; done = true; clearTimeout(wd); a.onended = a.onerror = null; URL.revokeObjectURL(url); this.endCb = null; err ? rej(err) : res(); };
      const wd = setTimeout(() => fin(), pcm.length / sr * 1000 + 4000); this.endCb = () => fin();
      a.onended = () => fin(); a.onerror = () => fin(new Error('Ljudet kunde inte spelas'));
      a.src = url; const pr = a.play(); if (pr && pr.catch) pr.catch(e => fin(e)); });
  },
  _end(s){ if (this.src === s){ this.src = null; const cb = this.endCb; this.endCb = null; if (cb) cb(); } },
  stop(){ if (this.src){ const s = this.src; try { s.onended = null; s.stop(); } catch (e) {} this._end(s); }
    else if (this.endCb){ try { this.el.pause(); } catch (e) {} const cb = this.endCb; this.endCb = null; cb(); } },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Player.ctx && Player.ctx.state !== 'running') Player.ctx.resume().catch(() => {}); });

// Lokal neural röst i en Web Worker (tts-worker.js)
const Neural = {
  state: 'idle', pct: 0, err: '', info: null, worker: null, waiters: [], pending: new Map(), seq: 0, voice: 'lisa', stats: [],
  supported(){ return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && !!(window.AudioContext || window.webkitAudioContext || window.Audio); },
  load(){
    if (this.state === 'ready') return Promise.resolve(true);
    const p = new Promise(r => this.waiters.push(r));
    if (this.state === 'loading') return p;
    if (!this.supported()){ this.state = 'error'; this.err = 'Webbläsaren saknar Web Worker/WebAssembly'; this._settle(false); return p; }
    this.state = 'loading'; this.pct = 0; this.err = ''; updateVoiceChip();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    try {
      if (!this.worker){ this.worker = new Worker('tts-worker.js'); this.worker.onmessage = e => this._msg(e.data);
        this.worker.onerror = e => { this._fail('Röstmotorn kraschade' + (e && e.message ? ': ' + e.message : '')); }; }
      this.worker.postMessage({type: 'init', voice: this.voice});
    } catch (e) { this._fail(String(e && e.message || e)); }
    return p;
  },
  _settle(ok){ const w = this.waiters; this.waiters = []; w.forEach(r => r(ok)); updateVoiceChip(); },
  _fail(msg){ console.warn('Lokal röst:', msg); this.state = 'error'; this.err = msg; try { this.worker && this.worker.terminate(); } catch (e) {} this.worker = null;
    for (const [, p] of this.pending) p.rej(new Error(msg)); this.pending.clear(); this._settle(false); },
  _msg(m){
    if (m.type === 'progress'){ this.pct = m.pct; updateVoiceChip(); }
    else if (m.type === 'ready'){ this.state = 'ready'; this.info = m; LS.set('ttsCached', 1); console.log('Lokal röst klar', m); this._settle(true); }
    else if (m.type === 'error') this._fail(m.msg);
    else if (m.type === 'log') console.warn(m.msg);
    else { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      if (m.type === 'audio'){ this.stats.push({ms: m.ms, sec: m.sec}); if (this.stats.length > 50) this.stats.shift(); p.res(m); }
      else if (m.type === 'skipped') p.res(null); else p.rej(new Error(m.msg)); }
  },
  synth(text, lang){ if (this.state !== 'ready') return Promise.reject(new Error('Rösten är inte laddad'));
    const id = ++this.seq; return new Promise((res, rej) => { this.pending.set(id, {res, rej}); this.worker.postMessage({type: 'synth', id, text, lang}); }); },
  cancel(){ if (this.worker) this.worker.postMessage({type: 'cancel'}); for (const [, p] of this.pending) p.res(null); this.pending.clear(); },
};

const Voice = {
  hasSynth: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  voices: [], synthOk: null, active: 'text', queue: [], speaking: false, audio: null, token: 0, onDone: null, lastResult: '',
  loadVoices(){ if (!this.hasSynth) return; try { this.voices = speechSynthesis.getVoices() || []; } catch (e) { this.voices = []; } },
  unlock(){ // måste ske i ett tryck
    Player.unlock(); this.audio = Player.el;
    if (this.hasSynth){ try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} }
  },
  async probe(){ // finns det en fungerande inbyggd röst?
    if (!this.hasSynth){ this.synthOk = false; return false; }
    this.loadVoices();
    if (!this.voices.length) await new Promise(r => { const t = setTimeout(r, 1500); try { speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); r(); }, {once:true}); } catch (e) { r(); } });
    this.loadVoices();
    if (!this.voices.length){ this.synthOk = false; return false; }
    this.synthOk = await new Promise(res => {
      let done = false; const fin = v => { if (!done){ done = true; res(v); } };
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(S.lang === 'sv' ? 'Reseguiden är igång.' : 'The travel guide is on.');
        u.lang = VOICE_LANG[S.lang]; const v = this.pick(S.lang); if (v) u.voice = v;
        u.onstart = () => fin(true); u.onend = () => fin(true); u.onerror = () => fin(false); speechSynthesis.speak(u); } catch (e) { fin(false); }
      setTimeout(() => fin(false), 4000);
    });
    return this.synthOk;
  },
  pick(lang){ const L = VOICE_LANG[lang] || lang, vs = this.voices;
    return vs.find(v => v.lang && v.lang.replace('_', '-').toLowerCase() === L.toLowerCase()) || vs.find(v => v.lang && v.lang.toLowerCase().startsWith(lang)) || null; },
  hasLang(lang){ return !!this.pick(lang); },
  choose(){
    const e = S.engine;
    if (e === 'text') this.active = 'text';
    else if (e === 'online') this.active = 'online';
    else if (e === 'browser') this.active = this.hasSynth ? 'browser' : 'text';
    else if (e === 'local') this.active = Neural.state === 'error' ? 'text' : 'neural';
    else { // automatisk
      if (this.synthOk && this.hasLang(S.lang)) this.active = 'browser';
      else if (Neural.supported() && Neural.state !== 'error') this.active = 'neural';
      else if (this.synthOk) this.active = 'browser';
      else this.active = 'online'; // sista utväg; faller till text om den inte svarar
    }
    if (this.active === 'neural' && Neural.state === 'idle') Neural.load().then(() => this.choose());
    updateVoiceChip();
  },
  stop(){ this.token++; this.queue = []; this.speaking = false; speakBar(false);
    if (this.hasSynth) try { speechSynthesis.cancel(); } catch (e) {}
    Neural.cancel(); Player.stop();
    if (this.audio) try { this.audio.pause(); } catch (e) {} },
  // parts: [{text, lang}]; opts.wait = vänta på att den lokala rösten laddats (används av Testa rösten)
  speak(parts, onDone, opts){
    this.stop(); const tok = this.token; this.onDone = onDone || null;
    const textOnly = () => setTimeout(() => { if (tok === this.token && this.onDone){ const cb = this.onDone; this.onDone = null; cb(); } }, 100);
    if (this.active === 'text') return textOnly();
    if (this.active === 'neural' && Neural.state !== 'ready'){
      if (!(opts && opts.wait)) return textOnly(); // laddar fortfarande – visa texten, läs nästa gång
      this.speaking = true; speakBar(true);
      Neural.load().then(ok => { if (tok !== this.token) return; this.speaking = false; if (ok) this.speak(parts, onDone); else { this.choose(); textOnly(); } });
      return;
    }
    const q = [];
    for (const p of parts){ if (!p.text) continue;
      for (const s of sentences(p.text)){
        const max = this.active === 'online' ? 190 : this.active === 'neural' ? 260 : 0;
        if (max) for (const c of chunk(s, max)) q.push({text: c, lang: p.lang}); else q.push({text: s, lang: p.lang}); } }
    this.queue = q; this.speaking = true; speakBar(true); this.next(tok);
  },
  _finish(tok){ if (tok !== this.token) return; this.speaking = false; speakBar(false); const cb = this.onDone; this.onDone = null; if (cb) cb(); },
  next(tok){
    if (tok !== this.token) return;
    const it = this.queue.shift();
    if (!it) return this._finish(tok);
    const go = () => this.next(tok);
    if (this.active === 'browser'){
      try { const u = new SpeechSynthesisUtterance(it.text); u.lang = VOICE_LANG[it.lang] || it.lang; const v = this.pick(it.lang); if (v) u.voice = v; u.rate = 1.0;
        let ended = false; const end = () => { if (!ended){ ended = true; clearTimeout(wd); go(); } };
        u.onend = end; u.onerror = e => { console.warn('tal-fel', e && e.error); end(); };
        const wd = setTimeout(end, 4000 + it.text.length * 110); // vakthund om webbläsaren tystnar
        speechSynthesis.speak(u); } catch (e) { go(); }
    } else if (this.active === 'neural'){
      const job = it.job || Neural.synth(it.text, it.lang);
      if (this.queue[0] && !this.queue[0].job){ const n = this.queue[0]; n.job = Neural.synth(n.text, n.lang); n.job.catch(() => {}); } // förberäkna nästa mening medan denna spelas
      job.then(a => { if (tok !== this.token || !a) return; return Player.play(a.pcm, a.sr).then(() => { neuralFails = 0; this.lastResult = 'ok'; }); })
        .catch(e => { neuralFail(e); })
        .then(() => { if (tok === this.token) go(); });
    } else {
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(it.lang) + '&q=' + encodeURIComponent(it.text);
      const a = Player.el || (Player.el = new Audio()); this.audio = a;
      let ended = false; const end = ok => { if (!ended){ ended = true; a.onended = a.onerror = null; clearTimeout(wd); if (ok) onlineFails = 0; this.lastResult = ok ? 'ok' : 'fel'; go(); } };
      const wd = setTimeout(() => end(false), 6000 + it.text.length * 120);
      a.onended = () => end(true); a.onerror = () => { onlineFail(); end(false); };
      a.src = url; const pr = a.play(); if (pr && pr.catch) pr.catch(e => { console.warn('online-röst', e); onlineFail(); end(false); });
    }
  },
  pause(){ if (this.active === 'browser') try { speechSynthesis.pause(); } catch (e) {} else Player.stop(); },
};
function chunk(s, n){ const out = []; let cur = '';
  const words = s.length > n ? s.split(/(?<=[,;:])\s+|\s+/) : [s]; // dela helst vid kommatecken
  for (const w of words){ if ((cur + ' ' + w).trim().length > n){ if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; }
let onlineFails = 0, neuralFails = 0;
function onlineFail(){ onlineFails++; Voice.lastResult = 'fel';
  if (onlineFails === 3){ showMsg('Online-rösten svarar inte (ingen uppkoppling eller blockerad). Guiden fortsätter med text på skärmen.', 'info', 7000);
    if (S.engine === 'auto'){ Voice.active = 'text'; updateVoiceChip(); } } }
function neuralFail(e){ neuralFails++; Voice.lastResult = 'fel'; console.warn('Lokal röst – fel:', e);
  if (neuralFails === 3) showMsg('Den lokala rösten kunde inte spela upp ljud (' + (e && e.message || e) + '). Texten visas fortfarande på skärmen.', 'info', 8000); }
function speakBar(on){ $('speakbar').classList.toggle('on', !!on); }
function updateVoiceChip(){
  const a = Voice.active, d = $('dVoice'), t = $('tVoice'), N = Neural;
  let txt, cls;
  if (a === 'neural'){
    if (N.state === 'ready'){ txt = 'Röst: klar'; cls = 'ok'; }
    else if (N.state === 'loading'){ txt = 'Röst: laddar ' + N.pct + '%'; cls = 'warn'; }
    else if (N.state === 'error'){ txt = 'Röst: fel'; cls = 'err'; }
    else { txt = 'Röst: lokal'; cls = 'warn'; }
  } else if (a === 'browser'){ txt = 'Röst: på'; cls = 'ok'; }
  else if (a === 'online'){ txt = onlineFails >= 3 ? 'Röst: online (svarar ej)' : 'Röst: online'; cls = onlineFails >= 3 ? 'err' : 'ok'; }
  else { txt = 'Endast text'; cls = 'warn'; }
  d.className = 'dot ' + cls; t.textContent = txt;
  const syn = !Voice.hasSynth ? 'Webbläsaren saknar talsyntes (speechSynthesis).' :
    Voice.synthOk === false ? `Webbläsarens talsyntes har inga fungerande röster (${Voice.voices.length} röster hittades).` :
    Voice.synthOk ? `Webbläsarens röst fungerar. Svensk röst: ${Voice.hasLang('sv') ? Voice.pick('sv').name : 'saknas'}.` : 'Webbläsarens röst testas när du startar guiden.';
  const MB = N.info ? Math.round(N.info.bytes / 1e6) : 92;
  const loc = N.state === 'ready' ? `Lokal svensk AI-röst: klar${N.info && N.info.fromCache ? ' (från cache)' : ''}, laddades på ${(N.info.ms / 1000).toFixed(1)} s.` + (N.stats.length ? ` Senaste mening: ${N.stats[N.stats.length - 1].ms} ms för ${N.stats[N.stats.length - 1].sec.toFixed(1)} s tal.` : '') :
    N.state === 'loading' ? `Lokal svensk AI-röst: laddar ${N.pct}% (ca ${MB} MB första gången, sparas sedan i webbläsaren).` :
    N.state === 'error' ? `Lokal svensk AI-röst: fel – ${N.err}.` : `Lokal svensk AI-röst: inte laddad (ca ${MB} MB första gången – gärna via wifi).`;
  const act = {browser: 'webbläsarens röst', neural: 'lokal AI-röst', online: 'online-röst', text: 'endast text'}[a];
  $('voiceInfo').textContent = syn + ' ' + loc + ' Aktiv: ' + act + '.';
}

/* ---------- Berättande ---------- */
let running = false, paused = false, current = null, lastTell = 0, demo = null, skipNext = false;
function introFor(p, lang){
  const di = dirInfo(p, lang), t = p.title.replace(/\s*\([^)]*\)\s*$/, '');
  if (lang === 'sv') return di.short ? `${t}, alldeles intill.` : `${t}, ${di.txt}.`;
  return di.short ? `${t}, right here.` : `${t}, ${di.txt}.`;
}
async function preferLang(p){ // finns artikeln på önskat språk? använd den
  if (p.lang === S.lang || !p.ll) return p;
  try {
    const j = await api(S.lang, {action:'query', titles:p.ll, prop:'extracts|pageimages|info|description', exintro:1, explaintext:1, piprop:'thumbnail', pithumbsize:480});
    const q = j.query.pages[0]; if (q && !q.missing && q.extract && q.extract.length > 80){
      const k = S.lang + ':' + q.pageid; const np = Object.assign({}, p, {key:k, lang:S.lang, pageid:q.pageid, title:q.title, extract:q.extract, desc:q.description || p.desc, thumb:q.thumbnail ? q.thumbnail.source : p.thumb, length:q.length || p.length});
      pool.set(k, np); p.cat = null; return np; }
  } catch (e) {}
  return p;
}
async function tell(p, opts){
  opts = opts || {};
  if (!p.extract){ try { await fetchDetails(p.lang, [p.pageid]); Object.assign(p, details[p.key]); } catch (e) {} }
  if (!opts.fromHist) p = await preferLang(p);
  markTold(p); addHist(p); lastTell = Date.now(); current = p; current.moreShown = false;
  const st = shortText(p.extract); current.short = st;
  render(p, st.text, null);
  const parts = [{text: introFor(p, S.lang), lang: S.lang}, {text: st.text, lang: p.lang}];
  Voice.speak(parts, () => { lastTell = Date.now(); });
  updateButtons(); updateMap();
}
function render(p, text, more){
  const cat = p.cat || catByKey(p.catk);
  $('storyBody').classList.toggle('noimg', !p.thumb);
  $('sThumb').style.backgroundImage = p.thumb ? `url("${p.thumb.replace(/"/g, '%22')}")` : '';
  $('sKicker').textContent = (cat ? cat.i + ' ' + cat.l : 'Plats') + (p.lang !== S.lang ? ' · på ' + (LANG_NAME[p.lang] || p.lang) : '');
  $('sTitle').textContent = p.title;
  updateMeta();
  const d = $('sDesc'); d.innerHTML = ''; d.scrollTop = 0;
  const pe = document.createElement('p'); pe.textContent = text || (p.desc || ''); d.appendChild(pe);
  if (more){ for (const para of more){ const m = document.createElement('p'); m.className = 'more'; m.textContent = para; d.appendChild(m); } }
  const url = `https://${p.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
  $('sSrc').innerHTML = '';
  const s = $('sSrc'); s.append('Fakta från Wikipedia: ');
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.title; s.appendChild(a);
  s.append(` (${p.lang}.wikipedia.org) · `);
  const l = document.createElement('a'); l.href = 'https://creativecommons.org/licenses/by-sa/4.0/deed.sv'; l.target = '_blank'; l.rel = 'noopener'; l.textContent = 'CC BY-SA 4.0'; s.appendChild(l);
}
function updateMeta(){
  if (!current) return; const m = $('sMeta'); m.innerHTML = '';
  const di = dirInfo(current, 'sv');
  if (di.txt){ const s = document.createElement('span'); s.className = 'dir'; s.textContent = '📍 ' + (di.short ? 'Alldeles intill' : di.txt); m.appendChild(s); }
  if (current.desc){ const t = document.createElement('span'); t.className = 'tag'; t.textContent = current.desc; m.appendChild(t); }
}
async function tellMore(){
  if (!current) return;
  const p = current; let full = '';
  try { const j = await api(p.lang, {action:'query', pageids:p.pageid, prop:'extracts', explaintext:1, exsectionformat:'plain', exchars:6000}); full = (j.query.pages[0] || {}).extract || ''; } catch (e) { showMsg('Kunde inte hämta mer text just nu.', 'info', 4000); return; }
  if (current !== p) return;
  // ta bort rubriker/listor som inte låter bra
  const lines = full.split('\n').map(x => x.trim()).filter(x => x.length > 60 && /[.!?…]$/.test(x));
  const ss = sentences(cleanText(lines.join('\n')));
  const used = p.short ? p.short.used : 0; const rest = ss.slice(used);
  if (!rest.length){ showMsg('Det finns inte mer att berätta om ' + p.title + '.', 'info', 3500); return; }
  let txt = '', n = 0; for (const s of rest){ if (txt.length > 900 && n >= 3) break; txt += (txt ? ' ' : '') + s; n++; }
  const paras = []; let buf = ''; for (const s of sentences(txt)){ buf += (buf ? ' ' : '') + s; if (buf.length > 280){ paras.push(buf); buf = ''; } } if (buf) paras.push(buf);
  p.moreText = txt; p.moreShown = true;
  render(p, p.short.text, paras);
  $('sDesc').scrollTop = 0;
  Voice.speak([{text: txt, lang: p.lang}], () => { lastTell = Date.now(); });
  lastTell = Date.now();
}
function repeat(){ if (!current) return; const parts = [{text: introFor(current, S.lang), lang: S.lang}, {text: current.short ? current.short.text : '', lang: current.lang}];
  if (current.moreShown && current.moreText) parts.push({text: current.moreText, lang: current.lang});
  Voice.speak(parts, () => { lastTell = Date.now(); }); lastTell = Date.now(); }
function ranked(){ return [...pool.values()].filter(p => p.cat && !p.dup).map(p => [p, score(p)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]); }
function pickNext(){
  const min = TALK[S.talk].min;
  for (const [p, s] of ranked()){
    if (s < min) break; if (isTold(p)) continue;
    const d = dist(pos.lat, pos.lon, p.lat, p.lon); if (d > radiusFor(pos.kmh)) continue;
    return p;
  }
  return null;
}
function tick(){
  if (!running || !pos) return;
  updateMeta();
  refresh(false).then(() => {
    if (!running || paused || Voice.speaking) return;
    const tempo = demo ? S.tempo : 1;
    const gap = (skipNext ? 8 : TALK[S.talk].gap) * 1000 / tempo;
    if (Date.now() - lastTell < gap) return;
    const p = pickNext(); if (p){ skipNext = false; tell(p); }
  });
}

/* ---------- Position ---------- */
let pos = null, heading = null, lastFix = null;
function onPosition(lat, lon, speedMs, hdg, acc){
  const now = Date.now(); let kmh = speedMs != null && !isNaN(speedMs) && speedMs >= 0 ? speedMs * 3.6 : null;
  if (lastFix){ const d = dist(lastFix.lat, lastFix.lon, lat, lon), dt = (now - lastFix.t) / 1000;
    if (kmh == null && dt > 0.5 && (acc || 99) < 60) kmh = Math.min(250, d / dt * 3.6 * (demo ? 1 / S.tempo : 1));
    if (d > 25){ if (hdg == null || isNaN(hdg)) hdg = bearing(lastFix.lat, lastFix.lon, lat, lon); lastFix = {lat, lon, t: now}; }
  } else lastFix = {lat, lon, t: now};
  if (hdg != null && !isNaN(hdg) && (kmh == null || kmh > 5)) heading = hdg;
  pos = {lat, lon, kmh: kmh || 0, acc: acc || 0};
  $('tSpd').textContent = Math.round(pos.kmh); $('tRad').textContent = Math.round(radiusFor(pos.kmh) / 1000);
  setGps(gpsState(), null); moveCar(); prunePool();
}
function gpsState(){ return demo ? 'ok' : pos ? (pos.acc > 100 ? 'warn' : 'ok') : 'warn'; }
function setGps(st, txt){ $('dGps').className = 'dot ' + (st || ''); $('tGps').textContent = txt || (demo ? 'GPS: demo' : pos ? 'GPS: ' + (country || 'ok') : 'GPS: söker…'); }
const Geo = {
  id: null, poll: null, gotOne: false,
  start(){
    if (!('geolocation' in navigator)){ setGps('err', 'GPS: saknas'); showMsg('Webbläsaren ger inte tillgång till position. Prova Demo i stället.'); return; }
    setGps('warn', 'GPS: söker…'); const opt = {enableHighAccuracy:true, maximumAge:0, timeout:20000};
    // Teslas webbläsare: först en engångsfråga (visar behörighetsdialogen), sedan kontinuerlig bevakning
    this.id = -1;
    navigator.geolocation.getCurrentPosition(p => { this.gotOne = true; this.on(p); this.watch(opt); }, e => { if (e.code === 1) this.err(e); else this.watch(opt); }, opt);
  },
  watch(opt){ if (this.id !== -1) return;
    this.id = navigator.geolocation.watchPosition(p => { this.gotOne = true; this.on(p); }, e => { if (e.code === 1 && this.gotOne) this.startPoll(opt); else this.err(e); }, opt); },
  startPoll(){ if (this.poll) return; if (this.id >= 0) navigator.geolocation.clearWatch(this.id); this.id = -2;
    this.poll = setInterval(() => navigator.geolocation.getCurrentPosition(p => this.on(p), () => {}, {enableHighAccuracy:true, maximumAge:0, timeout:4000}), 2000); },
  on(p){ const c = p.coords; onPosition(c.latitude, c.longitude, c.speed, c.heading, c.accuracy); },
  err(e){ setGps('err', 'GPS: fel'); if (e.code === 1) showMsg('Positionen nekades. Tillåt platsåtkomst för sidan i webbläsaren och tryck Starta guiden igen – eller prova Demo.'); },
  stop(){ if (this.id != null && this.id >= 0) navigator.geolocation.clearWatch(this.id); this.id = null; if (this.poll){ clearInterval(this.poll); this.poll = null; } }
};

/* ---------- Demo ---------- */
function startDemo(key){
  const r = ROUTES[key]; if (!r) return;
  const pts = r.pts, seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++){ const d = dist(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]); seg.push(d); tot += d; }
  demo = {key, r, pts, seg, tot, s: 0, i: 0, timer: null};
  $('chipDemo').style.display = ''; $('chipDemo').textContent = 'DEMO · ' + r.name.split(':')[0].split(' (')[0];
  $('demoBar').classList.add('show'); $('bTempo').textContent = 'Tempo ×' + S.tempo; $('bDemo').textContent = 'Stoppa demo';
  const step = () => {
    if (!demo) return;
    const v = (r.speed + Math.sin(Date.now() / 20000) * 8) / 3.6; // m/s
    demo.s += v * S.tempo;
    if (demo.s >= demo.tot){ showMsg('Demoresan är slut. Välkommen fram! 🏁', 'info', 5000); stopDemo(); return; }
    let s = demo.s, i = 0; while (i < seg.length && s > seg[i]){ s -= seg[i]; i++; }
    const a = pts[i], b = pts[i+1] || pts[i], f = seg[i] ? s / seg[i] : 0;
    const lat = a[0] + (b[0] - a[0]) * f, lon = a[1] + (b[1] - a[1]) * f;
    onPosition(lat, lon, v, bearing(a[0], a[1], b[0], b[1]), 5);
  };
  step(); demo.timer = setInterval(step, 1000);
}
function stopDemo(){
  if (!demo) return; clearInterval(demo.timer); demo = null;
  $('chipDemo').style.display = 'none'; $('demoBar').classList.remove('show'); $('bDemo').textContent = 'Demo';
  if (running){ stopGuide(); }
}

/* ---------- Start/stopp ---------- */
let wakeLock = null;
async function keepAwake(){ try { if ('wakeLock' in navigator && document.visibilityState === 'visible'){ wakeLock = await navigator.wakeLock.request('screen');
  $('dWake').className = 'dot ok'; $('tWake').textContent = 'Skärm: vaken'; wakeLock.addEventListener('release', () => { $('dWake').className = 'dot warn'; $('tWake').textContent = 'Skärm: normal'; }); } } catch (e) { $('dWake').className = 'dot warn'; } }
document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') keepAwake(); });
let tickTimer = null;
async function startGuide(demoKey){
  Voice.unlock(); // i samma tryck – låser upp ljud i Tesla/mobil
  $('ovStart').classList.remove('show');
  running = true; paused = false; lastTell = Date.now() - 1e9;
  $('bStart').textContent = 'Stoppa guiden'; $('bStart').classList.add('on');
  ['bPlay', 'bSkip', 'bMore', 'bRepeat'].forEach(id => $(id).disabled = false); updateButtons();
  keepAwake(); initMap();
  if (demoKey) startDemo(demoKey); else Geo.start();
  clearInterval(tickTimer); tickTimer = setInterval(tick, 3000);
  setStory('Guiden är igång', demoKey ? 'Demo: ' + ROUTES[demoKey].name : 'Söker position…', demoKey ? 'Vi låtsaskör längs ' + ROUTES[demoKey].name + '. Guiden letar efter intressanta platser framför bilen.' : 'Guiden letar efter intressanta platser framför bilen så snart positionen är klar.');
  if (S.engine === 'auto' || S.engine === 'browser'){
    await Voice.probe(); Voice.choose();
    if (Voice.active === 'neural' && Neural.state !== 'ready') neuralLoadingMsg();
  } else Voice.choose();
  if (Voice.active === 'online' || (Voice.active === 'neural' && Neural.state === 'ready')) Voice.speak([{text: S.lang === 'sv' ? 'Reseguiden är igång.' : 'The travel guide is on.', lang: S.lang}]);
  setTimeout(tick, 500);
}
function neuralLoadingMsg(){
  if (LS.get('ttsCached', 0)) return; // redan nedladdad – laddas tyst från cachen
  showMsg('Webbläsaren har ingen inbyggd röst (vanligt i Tesla). Laddar ner en svensk AI-röst som körs direkt i bilen (ca 92 MB, bara första gången – sparas sedan). Guiden visar text tills rösten är klar.', 'info', 12000);
}
function stopGuide(){
  running = false; Voice.stop(); Geo.stop(); clearInterval(tickTimer);
  if (demo){ const d = demo; demo = null; clearInterval(d.timer); $('chipDemo').style.display = 'none'; $('demoBar').classList.remove('show'); $('bDemo').textContent = 'Demo'; }
  $('bStart').textContent = 'Starta guiden'; $('bStart').classList.remove('on');
  if (wakeLock){ wakeLock.release().catch(() => {}); wakeLock = null; }
  $('dWake').className = 'dot'; $('tWake').textContent = 'Skärm: normal'; setGps('', 'GPS: av'); $('dVoice').className = 'dot'; $('tVoice').textContent = 'Röst: av';
  updateButtons();
}
function setStory(kicker, title, text){ current = null; $('storyBody').classList.add('noimg'); $('sKicker').textContent = kicker; $('sTitle').textContent = title; $('sMeta').innerHTML = ''; $('sDesc').innerHTML = ''; const p = document.createElement('p'); p.textContent = text; $('sDesc').appendChild(p); $('sSrc').innerHTML = ''; }
function updateButtons(){
  $('bPlay').innerHTML = paused ? '<span class="ico">▶</span><span>Spela guiden</span>' : '<span class="ico">⏸</span><span>Pausa guiden</span>';
  $('bPlay').classList.toggle('on', paused);
  $('bMore').disabled = $('bRepeat').disabled = !current || !running; $('bSkip').disabled = !running;
}

/* ---------- Lista ---------- */
let tab = 'hist';
function renderList(){
  const L = $('list'); L.innerHTML = '';
  $('tabHist').classList.toggle('sel', tab === 'hist'); $('tabNear').classList.toggle('sel', tab === 'near');
  let items;
  if (tab === 'hist'){
    items = hist.map(h => ({p: h, sub: (catByKey(h.cat).l) + (pos ? ' · ' + fmtKm(dist(pos.lat, pos.lon, h.lat, h.lon), 'sv') + ' km bort' : ''), when: ago(h.t), icon: catByKey(h.cat).i}));
    if (!items.length){ L.innerHTML = '<div class="empty">Här hamnar platserna som guiden berättat om. Tryck på en plats för att höra den igen.</div>'; return; }
  } else {
    if (!pos){ L.innerHTML = '<div class="empty">Starta guiden (eller demo) så listas notabla platser i närheten.</div>'; return; }
    const near = [...pool.values()].filter(p => p.cat && !p.dup).map(p => ({p, d: dist(pos.lat, pos.lon, p.lat, p.lon), imp: p.cat.w * importance(p)}))
      .filter(x => x.d < 12000 && x.imp > 1.6).sort((a, b) => a.d - b.d).slice(0, 15);
    if (!near.length){ L.innerHTML = '<div class="empty">' + (refreshing ? 'Letar efter platser…' : 'Inga notabla platser hittade ännu i närheten.') + '</div>'; return; }
    items = near.map(x => ({p: x.p, sub: x.p.cat.l + ' · ' + dirInfo(x.p, 'sv').txt + (isTold(x.p) ? ' · berättad' : ''), icon: x.p.cat.i}));
  }
  for (const it of items){
    const b = document.createElement('button'); b.className = 'item';
    const ii = document.createElement('span'); ii.className = 'ii'; if (it.p.thumb) ii.style.backgroundImage = `url("${it.p.thumb}")`; else ii.textContent = it.icon;
    const tx = document.createElement('span'); const bt = document.createElement('b'); bt.textContent = it.p.title; const sm = document.createElement('small'); sm.textContent = it.sub; tx.append(bt, sm);
    const w = document.createElement('span'); w.className = 'when'; w.textContent = it.when || '';
    b.append(ii, tx, w);
    b.onclick = () => {
      if (!running){ showMsg('Tryck Starta guiden först (ljudet behöver låsas upp med ett tryck).', 'info', 3500); }
      Voice.unlock();
      const src = tab === 'hist' ? Object.assign({}, it.p, {cat: catByKey(it.p.cat), catk: it.p.cat}) : it.p;
      tell(src, {fromHist: tab === 'hist'});
    };
    L.appendChild(b);
  }
}
function ago(t){ const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'nyss'; if (m < 60) return m + ' min'; const h = Math.round(m / 60); if (h < 24) return h + ' h'; return Math.round(h / 24) + ' d'; }

/* ---------- Karta (Leaflet, laddas bara om den behövs) ---------- */
let map = null, carMk = null, placeLayer = null, mapLoading = false, follow = true;
function initMap(){
  if (!S.map || map || mapLoading) return; mapLoading = true; $('mapMsg').textContent = 'Laddar karta…';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
  const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  s.onload = () => { try { $('mapMsg').style.display = 'none';
    map = L.map('map', {zoomControl:false, attributionControl:true}).setView(pos ? [pos.lat, pos.lon] : [58.07, 11.82], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18, attribution:'© OpenStreetMap'}).addTo(map);
    placeLayer = L.layerGroup().addTo(map); map.on('dragstart', () => { follow = false; setTimeout(() => follow = true, 20000); });
    moveCar(); updateMap(); } catch (e) { $('mapMsg').textContent = 'Kartan kunde inte visas'; } };
  s.onerror = () => { $('mapMsg').textContent = 'Kartan kunde inte laddas (ingen uppkoppling?) – guiden fungerar ändå.'; mapLoading = false; };
  document.head.appendChild(s);
}
function moveCar(){ if (!map || !pos) return;
  if (!carMk) carMk = L.marker([pos.lat, pos.lon], {icon: L.divIcon({className:'', html:'<div class="carmk"></div>', iconSize:[22, 22], iconAnchor:[11, 11]}), zIndexOffset:1000}).addTo(map);
  else carMk.setLatLng([pos.lat, pos.lon]);
  if (follow){ const z = pos.kmh > 80 ? 11 : pos.kmh > 40 ? 12 : 13; map.setView([pos.lat, pos.lon], z, {animate:false}); }
}
let mapT = 0;
function updateMap(){ if (!map || !placeLayer) return; if (Date.now() - mapT < 1500) return; mapT = Date.now();
  placeLayer.clearLayers();
  const mn = TALK[S.talk].min * 0.6;
  for (const [p, s] of ranked().filter(x => x[1] >= mn || (current && x[0].key === current.key)).slice(0, 30)){
    const t = isTold(p), cur = current && current.key === p.key;
    L.circleMarker([p.lat, p.lon], {radius: cur ? 10 : 6, color: cur ? '#fff' : t ? '#555' : '#5b84ff', weight: cur ? 3 : 1.5, fillColor: cur ? '#e82127' : t ? '#444' : '#3e6ae1', fillOpacity: .9})
      .bindTooltip(p.title).on('click', () => tell(p)).addTo(placeLayer);
  }
}

/* ---------- UI ---------- */
let msgT = null;
function showMsg(t, cls, ms){ const m = $('msg'); m.className = cls || ''; m.textContent = t; m.style.display = 'block'; clearTimeout(msgT); msgT = setTimeout(hideMsg, ms || 8000); m.onclick = hideMsg; }
function hideMsg(){ $('msg').style.display = 'none'; }
function seg(id, key, conv, after){
  const el = $(id); el.querySelectorAll('button').forEach(b => b.onclick = () => { S[key] = conv ? conv(b.dataset.v) : b.dataset.v; saveS(); syncSegs(); if (after) after(); });
}
function syncSegs(){
  const m = {segTalk:'talk', segLang:'lang', segLang2:'lang', segEngine:'engine', segMem:'mem', segMap:'map'};
  for (const id in m) $(id).querySelectorAll('button').forEach(b => b.classList.toggle('sel', String(S[m[id]]) === b.dataset.v));
}
seg('segTalk', 'talk');
const onLang = () => { pool.clear(); geoCache.clear(); lastQuery = null; if (running) refresh(true); };
seg('segLang', 'lang', null, onLang); seg('segLang2', 'lang', null, onLang);
seg('segEngine', 'engine', null, () => { Voice.unlock(); onlineFails = 0; if (Neural.state === 'error' && S.engine === 'local') Neural.state = 'idle'; if ((S.engine === 'browser' || S.engine === 'auto') && Voice.synthOk == null) Voice.probe().then(() => Voice.choose()); else Voice.choose(); });
seg('segMem', 'mem', Number);
seg('segMap', 'map', Number, () => { $('rightCol').classList.toggle('nomap', !S.map); if (S.map && running) initMap(); if (map) setTimeout(() => map.invalidateSize(), 50); });
syncSegs(); $('rightCol').classList.toggle('nomap', !S.map);

$('bGoGps').onclick = () => startGuide(null);
$('bGoDemo1').onclick = () => startGuide('e6');
$('bGoDemo2').onclick = () => startGuide('rhen');
$('bGoHelp').onclick = () => { $('ovStart').classList.remove('show'); $('ovSet').classList.add('show'); updateVoiceChip(); };
$('bStart').onclick = () => { if (running) stopGuide(); else startGuide(null); };
$('bDemo').onclick = () => { if (demo){ stopDemo(); return; } if (running) stopGuide(); startGuide(demoChoice === 'e6' ? 'e6' : 'rhen'); demoChoice = demoChoice === 'e6' ? 'rhen' : 'e6'; };
let demoChoice = 'e6';
$('bDemoStop').onclick = () => stopDemo();
$('bTempo').onclick = () => { S.tempo = S.tempo === 1 ? 3 : S.tempo === 3 ? 6 : 1; saveS(); $('bTempo').textContent = 'Tempo ×' + S.tempo; };
$('bSettings').onclick = () => { updateVoiceChip(); $('ovSet').classList.add('show'); };
$('bCloseSet').onclick = () => { $('ovSet').classList.remove('show'); if (!running && !$('ovStart').dataset.seen){ $('ovStart').dataset.seen = 1; } };
$('bClear').onclick = () => { told = {}; LS.set('told', told); hist = []; LS.set('hist', hist); renderList(); showMsg('Guiden har glömt alla berättade platser.', 'info', 3000); };
$('bTestVoice').onclick = async () => {
  Voice.unlock(); // i trycket – låser upp ljudet
  if (Neural.state === 'error' && S.engine !== 'text') Neural.state = 'idle'; // försök igen
  onlineFails = 0;
  if (Voice.synthOk == null && (S.engine === 'auto' || S.engine === 'browser')) await Voice.probe();
  Voice.choose();
  if (Voice.active === 'text'){ showMsg(S.engine === 'text' ? 'Du har valt Endast text.' : 'Ingen röst fungerar i den här webbläsaren just nu. Texten visas på skärmen.', 'info', 6000); return; }
  const name = {browser: 'webbläsarens röst', neural: 'lokala AI-rösten', online: 'online-rösten'}[Voice.active];
  if (Voice.active === 'neural' && Neural.state !== 'ready') showMsg('Laddar den svenska AI-rösten… följ förloppet uppe till höger (Röst: laddar %).', 'info', 15000);
  Voice.lastResult = ''; const t0 = Date.now();
  Voice.speak([{text: 'Hej! Så här låter reseguiden. Välkommen till TeslaZanders.', lang: 'sv'}], () => {
    const ok = Voice.lastResult === 'ok' || Voice.active === 'browser';
    if (Voice.active === 'neural' && Neural.state !== 'ready') showMsg('Den lokala rösten kunde inte laddas: ' + (Neural.err || 'okänt fel') + '.', 'error', 10000);
    else showMsg(ok ? `✓ Rösttest klart med ${name}.` + (Voice.active === 'neural' && Neural.stats.length ? ` (${Neural.stats[Neural.stats.length - 1].ms} ms att skapa talet)` : '') : `✗ Ingen ljudsignal från ${name}. Kontrollera volymen eller välj en annan röst.`, ok ? 'info' : 'error', 7000);
    updateVoiceChip();
  }, {wait: true});
  updateVoiceChip(); };
$('bPlay').onclick = () => { paused = !paused; if (paused) Voice.stop(); else lastTell = Date.now() - 1e9; updateButtons(); };
$('bSkip').onclick = () => { Voice.stop(); skipNext = true; lastTell = Date.now() - 1e9; if (current) markTold(current); setTimeout(tick, 200); };
$('bMore').onclick = () => tellMore();
$('bRepeat').onclick = () => repeat();
$('tabHist').onclick = () => { tab = 'hist'; renderList(); };
$('tabNear').onclick = () => { tab = 'near'; renderList(); if (running && pos) refresh(true).then(renderList); };
if (Voice.hasSynth){ Voice.loadVoices(); try { speechSynthesis.addEventListener('voiceschanged', () => Voice.loadVoices()); } catch (e) {} }
if (LS.get('ttsCached', 0) && S.engine !== 'text' && S.engine !== 'browser' && S.engine !== 'online') setTimeout(() => Neural.load(), 1500); // redan nedladdad – förbered i bakgrunden
setInterval(() => { if (tab === 'hist') renderList(); }, 60000);
renderList(); updateButtons();
// för test/felsökning
window.RG = {Neural, Player, pool, details, ranked, pos: () => pos, heading: () => heading, Voice, hist: () => hist, told: () => told, current: () => current, apiCount: () => apiCount, shortText, introFor, S, startGuide, stopGuide, tick, refresh};
