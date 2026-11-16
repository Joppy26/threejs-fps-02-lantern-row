// audio.js — every sound is synthesized with WebAudio. No audio files, no network.
// One job: turn game events into sound. Callers pass an event name, never audio nodes.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }
  // Unlock on the first user gesture; browsers block audio before one.
  window.addEventListener('pointerdown', ensure, { once: true });
  window.addEventListener('keydown', ensure, { once: true });

  function noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function burst(dur, freq, type, gain, slideTo) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, filterFreq, gain, q = 1) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }
  function tone(freq, dur, type, gain, when = 0) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // distance: 0 (at the listener) to 1 (far). Far sounds get quieter, never silent.
  function vol(distance) {
    return Math.max(0.12, 1 - (distance ?? 0) / 55);
  }

  return {
    unlock: ensure,
    setEnabled(v) { enabled = v; },
    shot(kind, distance = 0) {
      const v = vol(distance);
      if (kind === 'railgun') { burst(0.5, 1400, 'sawtooth', 0.5 * v, 90); noise(0.4, 3200, 0.5 * v); return; }
      if (kind === 'dmr') { burst(0.22, 320, 'square', 0.5 * v, 70); noise(0.18, 1800, 0.4 * v); return; }
      if (kind === 'pistol') { burst(0.09, 520, 'square', 0.35 * v, 140); noise(0.08, 2400, 0.3 * v); return; }
      burst(0.11, 420, 'square', 0.4 * v, 110); noise(0.1, 2200, 0.35 * v);
    },
    dryFire() { burst(0.03, 900, 'square', 0.15, 500); },
    reload() { tone(1200, 0.05, 'square', 0.12); tone(800, 0.05, 'square', 0.12, 0.18); tone(1500, 0.05, 'square', 0.12, 0.36); },
    hitmarker(kill) { tone(kill ? 1400 : 1000, 0.06, 'sine', 0.25); if (kill) tone(1800, 0.12, 'sine', 0.25, 0.07); },
    hurt() { burst(0.15, 180, 'sawtooth', 0.3, 60); },
    step(distance = 0) { noise(0.05, 700, 0.08 * vol(distance)); },
    plantBeep(final) { tone(final ? 1600 : 1100, final ? 0.25 : 0.08, 'sine', 0.22); },
    defuseBeep() { tone(900, 0.08, 'sine', 0.2); },
    explosion() { noise(1.4, 500, 0.9, 0.6); burst(1.2, 90, 'sine', 0.7, 30); },
    grenadePin() { tone(2000, 0.04, 'square', 0.15); },
    flash() { burst(0.3, 2000, 'sine', 0.3, 300); },
    pickup() { tone(700, 0.08, 'sine', 0.25); tone(1050, 0.12, 'sine', 0.25, 0.08); },
    railgunSpawn() { tone(440, 0.4, 'sine', 0.2); tone(660, 0.4, 'sine', 0.2, 0.15); tone(880, 0.6, 'sine', 0.25, 0.3); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.35, 'triangle', 0.25, i * 0.13)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.22, i * 0.15)); },
    buy() { tone(980, 0.06, 'square', 0.15); tone(1240, 0.08, 'square', 0.15, 0.06); },
  };
}
