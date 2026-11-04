/* K.I.T.T. röstmodul – lokal svensk neural TTS i en Web Worker.
   Piper VITS-röst sv_SE-nst-medium (rhasspy/piper-voices, Hugging Face) körs med ONNX Runtime Web (WebAssembly, EN tråd)
   + piper_phonemize (espeak-ng som WASM, @diffusionstudio/piper-wasm). Kräver INTE SharedArrayBuffer eller
   cross-origin-isolering (COOP/COEP) – fungerar på GitHub Pages. Allt hämtas från CDN en gång och sparas i Cache API. */
'use strict';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PP_BASE  = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/e7229f7d33a10e145e109b886d661984201ac3c4/sv/sv_SE/';
const MODEL = 'nst/medium/sv_SE-nst-medium.onnx';
const CACHE = 'kitt-tts-v1';

let ORT = null, sess = null, cfg = null, phon = null, phonOut = null, loading = null;
let jobs = Promise.resolve(), epoch = 0;
const post = (m, t) => self.postMessage(m, t || []);

async function openCache(){ try { return self.caches ? await caches.open(CACHE) : null; } catch (e) { return null; } }

async function getBuf(url, onBytes){
  const c = await openCache();
  if (c){ try { const hit = await c.match(url); if (hit){ const b = await hit.arrayBuffer(); if (b.byteLength > 0){ onBytes(b.byteLength, true); return b; } } } catch (e) {} }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++){
    try {
      const r = await fetch(url, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!r.ok) throw new Error('HTTP ' + r.status + ' för ' + url.split('/').pop());
      let buf;
      if (r.body && r.body.getReader){
        const rd = r.body.getReader(), parts = []; let n = 0;
        for (;;){ const {done, value} = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(n, false); }
        const u = new Uint8Array(n); let o = 0; for (const p of parts){ u.set(p, o); o += p.length; } buf = u.buffer;
      } else { buf = await r.arrayBuffer(); onBytes(buf.byteLength, false); }
      if (c){ try { await c.put(url, new Response(buf, {headers: {'Content-Type': 'application/octet-stream'}})); } catch (e) { post({type:'log', msg:'Kunde inte cacha ' + url.split('/').pop()}); } }
      return buf;
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
  }
  throw lastErr;
}

async function init(){
  const t0 = performance.now();
  const files = [
    {url: HF + MODEL + '.json',          size: 4157},
    {url: PP_BASE + '.wasm',             size: 635212},
    {url: PP_BASE + '.data',             size: 18077249},
    {url: ORT_BASE + 'ort-wasm-simd.wasm', size: 10595041},
    {url: HF + MODEL,                    size: 63104526},
  ];
  const total = files.reduce((a, f) => a + f.size, 0), got = files.map(() => 0);
  let fromCache = true, lastPct = -1;
  const prog = i => (n, cached) => { got[i] = Math.min(n, files[i].size); if (!cached) fromCache = false;
    const pct = Math.floor(100 * got.reduce((a, b) => a + b, 0) / total); if (pct !== lastPct){ lastPct = pct; post({type:'progress', pct, total}); } };
  // OBS: ingen global variabel får heta "ort" (krockar med bibliotekets egen deklaration → importScripts misslyckas)
  for (let i = 0; ; i++){
    try { if (!self.ort) importScripts(ORT_BASE + 'ort.wasm.min.js'); if (!self.createPiperPhonemize) importScripts(PP_BASE + '.js'); break; }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  ORT = self.ort;
  const bufs = await Promise.all(files.map((f, i) => getBuf(f.url, prog(i))));
  const dlMs = performance.now() - t0;
  cfg = JSON.parse(new TextDecoder().decode(bufs[0]));
  const ppData = bufs[2];
  phon = await self.createPiperPhonemize({
    print: l => { phonOut = l; }, printErr: () => {},
    wasmBinary: bufs[1], getPreloadedPackage: () => ppData,
    locateFile: f => f.endsWith('.wasm') ? PP_BASE + '.wasm' : f.endsWith('.data') ? PP_BASE + '.data' : f,
    noInitialRun: true,
  });
  ORT.env.wasm.numThreads = 1; ORT.env.wasm.proxy = false;   // ingen SharedArrayBuffer behövs
  ORT.env.wasm.wasmPaths = {'ort-wasm-simd.wasm': URL.createObjectURL(new Blob([bufs[3]], {type: 'application/wasm'})), 'ort-wasm.wasm': ORT_BASE + 'ort-wasm.wasm'};
  const tS = performance.now();
  sess = await ORT.InferenceSession.create(bufs[4], {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
  const sessMs = performance.now() - tS;
  const tw = performance.now(); await infer('Hej.', 1); const warmMs = performance.now() - tw;
  post({type:'ready', fromCache, ms: Math.round(performance.now() - t0), dlMs: Math.round(dlMs), sessMs: Math.round(sessMs), warmMs: Math.round(warmMs),
    bytes: total, sab: typeof SharedArrayBuffer !== 'undefined', isolated: !!self.crossOriginIsolated});
}

function phonemize(text){
  phonOut = null;
  try { phon.callMain(['-l', 'sv', '--input', JSON.stringify([{text}]), '--espeak_data', '/espeak-ng-data']); } catch (e) {}
  return phonOut ? JSON.parse(phonOut).phoneme_ids : null;
}

async function infer(text, lengthScale, noise, noiseW){
  const ids = phonemize(text); if (!ids || !ids.length) throw new Error('Kunde inte fonemisera texten');
  const inf = cfg.inference || {};
  const feeds = {
    input: new ORT.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ORT.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ORT.Tensor('float32', Float32Array.from([noise ?? 0.55, (inf.length_scale ?? 1) * (lengthScale || 1), noiseW ?? 0.7]), [3]),
  };
  const out = await sess.run(feeds);
  return new Float32Array(out.output.data);
}

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init'){
    if (!loading) loading = init().catch(err => { loading = null; post({type:'error', msg: String(err && err.message || err)}); });
  } else if (m.type === 'cancel'){
    epoch++;
  } else if (m.type === 'synth'){
    const my = epoch;
    jobs = jobs.then(async () => {
      if (my !== epoch) return post({type:'skipped', id: m.id});
      try { const t = performance.now(); const pcm = await infer(m.text, m.lengthScale, m.noise, m.noiseW);
        post({type:'audio', id: m.id, pcm, sr: cfg.audio.sample_rate, ms: Math.round(performance.now() - t), sec: pcm.length / cfg.audio.sample_rate}, [pcm.buffer]);
      } catch (err) { post({type:'synthError', id: m.id, msg: String(err && err.message || err)}); }
    });
  }
};
