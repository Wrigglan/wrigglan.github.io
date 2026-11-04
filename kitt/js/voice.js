/* K.I.T.T. ljudmotor + röst.
   – EN AudioContext som låses upp vid första tryckningen och återupptas vid visibilitychange.
   – Röstkedja (Web Audio): naturlig fullbandig EQ (lågcut ~120 Hz, mild närvaro 2–4 kHz), svag elektronisk glans, kompressor och mycket kort kupé-efterklang.
     Det är en egen syntetisk "bil-AI"-röst – ingen imitation av någon skådespelare och inget ljud från TV-serien.
   – Röstkälla i första hand: lokal Piper-TTS (tts-worker.js). Reserv: speechSynthesis (svensk röst) → enbart text på CRT. */
'use strict';
(function(){
const AC = window.AudioContext || window.webkitAudioContext;
/* Röstvarianter (alla med Piper sv_SE-nst-medium – den enda svenska mansrösten i piper-voices).
   Mål: KITT-karaktärens stil – förfinad, lugn, artig och tydlig bil-AI. Ingen imitation av någon verklig röst. */
const VARIANTS = {
  A: {name: 'A – naturlig & varm', pitch: 1.00, length: 1.06, noise: 0.50, noiseW: 0.60, lowcut: 120, pres: 2.0, presF: 3000, sheen: 1.5, excite: 0.000, rev: 0.07, chorus: 0},
  B: {name: 'B – klar & precis',   pitch: 1.03, length: 1.08, noise: 0.45, noiseW: 0.55, lowcut: 125, pres: 3.0, presF: 2800, sheen: 2.5, excite: 0.035, rev: 0.09, chorus: 0},
  C: {name: 'C – ljusare & elektronisk', pitch: 1.05, length: 1.10, noise: 0.40, noiseW: 0.50, lowcut: 140, pres: 3.5, presF: 3200, sheen: 4.0, excite: 0.06, rev: 0.12, chorus: 0.05},
};
const DEFAULT_VARIANT = 'C';
let VKEY = DEFAULT_VARIANT;
try { const q = (new URLSearchParams(location.search).get('rost') || '').toUpperCase(); if (VARIANTS[q]) VKEY = q; } catch (e) {}
let VAR = VARIANTS[VKEY];

// Deterministisk brus-generator (samma efterklang live och offline)
function prng(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }

/* Mycket kort "kupé-högtalar"-efterklang: några tidiga reflexer + snabb avklingning */
function cabinIR(ctx){
  const sr = ctx.sampleRate, len = Math.floor(sr * 0.22), ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++){
    const d = ir.getChannelData(ch), rnd = prng(23 + ch * 77);
    for (let i = 0; i < len; i++){ const t = i / sr; d[i] = rnd() * Math.exp(-t * 26) * 0.5; }
    [0.0031, 0.0057, 0.0089, 0.0124].forEach((tt, k) => { const i = Math.floor(sr * (tt + ch * 0.0006)); if (i < len) d[i] += (k % 2 ? -1 : 1) * (0.7 - k * 0.12); });
    let mx = 0; for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(d[i])); for (let i = 0; i < len; i++) d[i] /= (mx || 1) * 1.4;
  }
  return ir;
}

/* Bygger KITT-röstkedjan i valfri (även Offline-)AudioContext. Returnerar ingångsnoden. */
function buildKittChain(ctx, out, v){
  v = v || VAR;
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.lowcut; hp.Q.value = 0.707;
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 320; mud.gain.value = -1.5; mud.Q.value = 1.0;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = v.presF; pres.gain.value = v.pres; pres.Q.value = 0.8;
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 7500; shelf.gain.value = v.sheen;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 14000; lp.Q.value = 0.5;
  input.connect(hp); hp.connect(mud); mud.connect(pres); pres.connect(shelf); shelf.connect(lp);
  const sum = ctx.createGain(); lp.connect(sum);
  // svag, ren elektronisk glans: övertoner från diskantbandet (exciter)
  if (v.excite > 0){
    const xh = ctx.createBiquadFilter(); xh.type = 'highpass'; xh.frequency.value = 3500;
    const ws = ctx.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++){ const x = i / 511.5 - 1; cv[i] = Math.tanh(x * 4); } ws.curve = cv;
    const xg = ctx.createGain(); xg.gain.value = v.excite; lp.connect(xh); xh.connect(ws); ws.connect(xg); xg.connect(sum);
  }
  if (v.chorus > 0){
    const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.012; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.25;
    const lg = ctx.createGain(); lg.gain.value = 0.0006; lfo.connect(lg); lg.connect(dl.delayTime); lfo.start();
    const g = ctx.createGain(); g.gain.value = v.chorus; lp.connect(dl); dl.connect(g); g.connect(sum);
  }
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.18;
  sum.connect(comp);
  const conv = ctx.createConvolver(); conv.buffer = cabinIR(ctx); const wet = ctx.createGain(); wet.gain.value = v.rev;
  comp.connect(conv); conv.connect(wet);
  const makeup = ctx.createGain(); makeup.gain.value = 1.15;
  comp.connect(makeup); wet.connect(makeup); makeup.connect(out);
  return input;
}

function wavEncode(abuf){
  const ch = abuf.numberOfChannels, sr = abuf.sampleRate, n = abuf.length, dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(abuf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++){ const s = Math.max(-1, Math.min(1, chans[c][i])); dv.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
  return dv.buffer;
}

/* ===================== Ljudmotor ===================== */
const Audio = {
  ctx: null, master: null, voiceIn: null, analyser: null, fx: null, vol: 7, muted: false,
  unlock(){
    if (!AC) return false;
    if (!this.ctx){
      this.ctx = new AC({latencyHint: 'interactive'});
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.35;
      this.analyser.connect(this.master);
      this.voiceIn = buildKittChain(this.ctx, this.analyser);
      this.fx = this.ctx.createGain(); this.fx.gain.value = 0.9; this.fx.connect(this.master);
      // tyst buffert = "lås upp" på iOS/äldre Chromium
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.master); s.start(0);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.resume(); });
      this.applyVol();
    }
    this.resume();
    return true;
  },
  resume(){ if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); },
  applyVol(){ if (!this.master) return; const g = this.muted ? 0 : Math.pow(this.vol / 10, 1.6) * 1.1; this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.04); },
  setVol(v){ this.vol = Math.max(0, Math.min(10, v)); this.applyVol(); },
  setMuted(m){ this.muted = m; this.applyVol(); },
  beep(f = 1250, d = 0.05, type = 'square', g = 0.06){
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), a = c.createGain();
    o.type = type; o.frequency.value = f; a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + 0.005); a.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(a); a.connect(this.fx); o.start(t); o.stop(t + d + 0.02);
  },
  /* syntetiserat turbo-"whoosh": filtrerat brus som sveper uppåt + mullrande sågtand + uppvarvning */
  whoosh(){
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, D = 2.6;
    const nb = c.createBuffer(1, Math.floor(c.sampleRate * D), c.sampleRate), d = nb.getChannelData(0), r = prng(5);
    for (let i = 0; i < d.length; i++) d[i] = r();
    const n = c.createBufferSource(); n.buffer = nb;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.9); bp.frequency.exponentialRampToValueAtTime(350, t + D);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.9, t + 0.7); ng.gain.exponentialRampToValueAtTime(0.0001, t + D);
    n.connect(bp); bp.connect(ng); ng.connect(this.fx); n.start(t); n.stop(t + D);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); o.frequency.exponentialRampToValueAtTime(150, t + 1.1); o.frequency.exponentialRampToValueAtTime(45, t + D);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.45, t + 0.5); og.gain.exponentialRampToValueAtTime(0.0001, t + D);
    o.connect(lp); lp.connect(og); og.connect(this.fx); o.start(t); o.stop(t + D);
    const s = c.createOscillator(); s.type = 'triangle'; s.frequency.setValueAtTime(320, t); s.frequency.exponentialRampToValueAtTime(1900, t + 1.0);
    const sg = c.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.12, t + 0.6); sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    s.connect(sg); sg.connect(this.fx); s.start(t); s.stop(t + 1.4);
  },
  /* nivåer för röstboxen: [yttre, mitten] 0..1 */
  _td: null, _fd: null,
  levels(){
    if (!this.analyser) return [0, 0];
    const a = this.analyser; if (!this._td){ this._td = new Float32Array(a.fftSize); this._fd = new Uint8Array(a.frequencyBinCount); }
    a.getFloatTimeDomainData(this._td); let s = 0; for (let i = 0; i < this._td.length; i++) s += this._td[i] * this._td[i];
    const rms = Math.sqrt(s / this._td.length);
    a.getByteFrequencyData(this._fd); const bin = this.ctx.sampleRate / a.fftSize; let lo = 0, nl = 0;
    for (let i = Math.floor(150 / bin); i < Math.floor(900 / bin); i++){ lo += this._fd[i]; nl++; }
    const mid = Math.min(1, rms * 5.5), outer = Math.min(1, Math.max(0, (lo / (nl || 1) - 70) / 150));
    return [outer, mid, rms];
  }
};

/* ===================== Tal ===================== */
function speechText(t){
  return t.replace(/K\.I\.T\.T\./g, 'Kitt').replace(/\bKITT\b/g, 'Kitt').replace(/TeslaZanders/g, 'Tesla Zanders')
    .replace(/GPS:en/g, 'GPS:en').replace(/\bkm\/h\b/g, 'kilometer i timmen');
}
function chunks(text){
  const out = [];
  (text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) || [text]).forEach(s => {
    s = s.trim(); if (!s) return;
    while (s.length > 190){ let k = s.lastIndexOf(',', 170); if (k < 60) k = s.lastIndexOf(' ', 170); if (k < 30) k = 170; out.push(s.slice(0, k + 1).trim()); s = s.slice(k + 1).trim(); }
    if (s) out.push(s);
  });
  return out;
}

const Voice = {
  worker: null, state: 'idle', pct: 0, info: null, err: null, onstate: null, nextId: 1,
  queue: [], playing: null, pending: [], sim: 0, simUntil: 0, stats: {played: 0, synth: [], chunks: 0},
  svVoice: null, mode: 'none',   // 'tts' | 'speech' | 'text'
  _emit(){ this.onstate && this.onstate(this); },
  init(){
    this.pickSpeechVoice(); if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => this.pickSpeechVoice();
    if (this.worker || typeof Worker === 'undefined' || typeof WebAssembly !== 'object'){ if (!this.worker){ this.state = 'error'; this.err = 'Webbläsaren saknar Worker/WebAssembly'; this._emit(); } return; }
    this.state = 'loading'; this._emit();
    try {
      this.worker = new Worker('js/tts-worker.js');
      this.worker.onmessage = e => this._msg(e.data);
      this.worker.onerror = e => { this.state = 'error'; this.err = 'Worker-fel'; e.preventDefault && e.preventDefault(); this._fallbackPending(); this._emit(); };
      this.worker.postMessage({type: 'init'});
    } catch (e) { this.state = 'error'; this.err = String(e); this._emit(); }
  },
  pickSpeechVoice(){
    try { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; this.svVoice = vs.find(v => /^sv/i.test(v.lang)) || null; } catch (e) { this.svVoice = null; }
  },
  _msg(m){
    if (m.type === 'progress'){ this.pct = m.pct; this._emit(); }
    else if (m.type === 'ready'){ this.state = 'ready'; this.pct = 100; this.info = m; this._emit(); const p = this.pending; this.pending = []; p.forEach(t => this.say(t)); }
    else if (m.type === 'error'){ this.state = 'error'; this.err = m.msg; console.warn('Röstmodul:', m.msg); this._fallbackPending(); this._emit(); }
    else if (m.type === 'audio'){ const it = this.queue.find(q => q.id === m.id); if (it){ it.pcm = m.pcm; it.sr = m.sr; this.stats.synth.push({ms: m.ms, sec: m.sec}); } this.pump(); }
    else if (m.type === 'synthError' || m.type === 'skipped'){ const it = this.queue.find(q => q.id === m.id); if (it) it.fail = true; this.pump(); }
  },
  _fallbackPending(){ const p = this.pending; this.pending = []; p.forEach(t => this.say(t)); },
  get speaking(){ return !!this.playing || this.queue.length > 0 || performance.now() < this.simUntil || (window.speechSynthesis && speechSynthesis.speaking); },
  /* simulerad amplitud när ljud inte kan analyseras (speechSynthesis / bara text) */
  simLevel(){ if (performance.now() > this.simUntil) return 0; const t = performance.now() / 1000; return Math.max(0, 0.45 + 0.35 * Math.sin(t * 17) * Math.sin(t * 5.3) + 0.2 * Math.sin(t * 31)); },
  cancel(){
    this.queue = []; this.pending = []; this.simUntil = 0;
    if (this.playing){ try { this.playing.onended = null; this.playing.stop(); } catch (e) {} this.playing = null; }
    if (this.worker) this.worker.postMessage({type: 'cancel'});
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {}
  },
  say(text){
    const t = speechText(text);
    if (Audio.muted){ this.mode = 'text'; this.simUntil = performance.now() + Math.min(6000, 900 + t.length * 45); return 'text'; }
    if (this.state === 'ready' && Audio.ctx){
      this.mode = 'tts';
      chunks(t).forEach(c => { const id = this.nextId++; this.queue.push({id, text: c}); this.stats.chunks++; this.worker.postMessage({type: 'synth', id, text: c, lengthScale: VAR.length, noise: VAR.noise, noiseW: VAR.noiseW}); });
      this.pump(); return 'tts';
    }
    if (this.state === 'loading' && !this.svVoice){
      this.pending.push(text); if (this.pending.length > 3) this.pending.splice(1, 1);   // hälsningen behålls, äldre repliker släpps
      this.mode = 'wait'; return 'wait';
    }
    if (this.svVoice && window.speechSynthesis){
      this.mode = 'speech';
      chunks(t).forEach(c => { const u = new SpeechSynthesisUtterance(c); u.voice = this.svVoice; u.lang = this.svVoice.lang; u.pitch = 1.0; u.rate = 0.92; u.volume = Math.min(1, Audio.vol / 10);
        u.onstart = () => { this.simUntil = performance.now() + c.length * 75; }; u.onend = () => { this.simUntil = 0; this.stats.played++; }; speechSynthesis.speak(u); });
      return 'speech';
    }
    this.mode = 'text'; this.simUntil = performance.now() + Math.min(6000, 900 + t.length * 45); return 'text';
  },
  pump(){
    if (this.playing) return;
    while (this.queue.length && this.queue[0].fail) this.queue.shift();
    const it = this.queue[0]; if (!it || !it.pcm) return;
    const c = Audio.ctx; Audio.resume();
    const b = c.createBuffer(1, it.pcm.length, it.sr); b.copyToChannel ? b.copyToChannel(it.pcm, 0) : b.getChannelData(0).set(it.pcm);
    const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = VAR.pitch; s.connect(Audio.voiceIn);
    s.onended = () => { if (this.playing !== s) return; this.playing = null; this.queue.shift(); this.stats.played++; setTimeout(() => this.pump(), 90); };
    this.playing = s; s.start(c.currentTime + 0.03);
  },
  /* Renderar ett röstprov genom samma KITT-kedja i en OfflineAudioContext → WAV (ArrayBuffer) */
  synthRaw(text){
    return new Promise((res, rej) => {
      if (this.state !== 'ready') return rej(new Error('Röstmodulen är inte klar'));
      const id = this.nextId++, h = e => { const m = e.data; if (m.id !== id) return; this.worker.removeEventListener('message', h); m.type === 'audio' ? res(m) : rej(new Error(m.msg || m.type)); };
      this.worker.addEventListener('message', h); this.worker.postMessage({type: 'synth', id, text: speechText(text), lengthScale: VAR.length, noise: VAR.noise, noiseW: VAR.noiseW});
    });
  },
  async renderSample(texts, key){
    const prev = VAR; if (key && VARIANTS[key]) VAR = VARIANTS[key];
    try {
    const parts = []; let sr = 22050;
    for (const t of texts) for (const c of chunks(speechText(t))){ const m = await this.synthRaw(c); sr = m.sr; parts.push(m.pcm, new Float32Array(Math.floor(sr * 0.32))); }
    const n = parts.reduce((a, p) => a + p.length, 0), pcm = new Float32Array(n); let o = 0; for (const p of parts){ pcm.set(p, o); o += p.length; }
    const OSR = 44100, len = Math.ceil(n / sr / VAR.pitch * OSR + OSR * 0.8);
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, len, OSR);
    const inp = buildKittChain(oc, oc.destination, VAR);
    const b = oc.createBuffer(1, n, sr); b.getChannelData(0).set(pcm);
    const s = oc.createBufferSource(); s.buffer = b; s.playbackRate.value = VAR.pitch; s.connect(inp); s.start(0.05);
    const out = await oc.startRendering();
    return wavEncode(out);
    } finally { VAR = prev; }
  }
};

Voice.variant = () => VKEY; Voice.variants = VARIANTS;
window.KittAudio = Audio; window.KittVoice = Voice; window.buildKittChain = buildKittChain;
})();
