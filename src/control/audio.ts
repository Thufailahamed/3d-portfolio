/**
 * The room's sound: air handling and the hum of a hundred racks, Quindar tones bracketing the
 * capsule loop (2525 Hz in, 2475 Hz out, 250 ms — the Apollo "beep"), console chirps, the master
 * alarm, and the launch feed's rumble from the pad speakers. Voices use the browser's speech engine.
 */

export class RoomAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rumble!: { g: GainNode; f: BiquadFilterNode; crackle: GainNode };
  private muted = false;
  private voiceOn = true;
  private voices: SpeechSynthesisVoice[] = [];
  private speaking = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 3;
    const brown = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = brown.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.2;
      }
    }
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

    // HVAC: low brown noise
    const hvac = ctx.createBufferSource();
    hvac.buffer = brown;
    hvac.loop = true;
    const hf = ctx.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.value = 420;
    const hg = ctx.createGain();
    hg.gain.value = 0.05;
    hvac.connect(hf).connect(hg).connect(this.master);
    hvac.start();
    // equipment hum: 60 Hz mains and its harmonics
    [60, 120, 180].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.006 / (i + 1);
      o.connect(g).connect(this.master);
      o.start();
    });

    // launch rumble (driven every frame)
    const rs = ctx.createBufferSource();
    rs.buffer = brown;
    rs.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 160;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rs.connect(rf).connect(rg).connect(this.master);
    rs.start();
    const cs = ctx.createBufferSource();
    cs.buffer = white;
    cs.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 900;
    cf.Q.value = 0.6;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    cs.connect(cf).connect(cg).connect(this.master);
    cs.start();
    this.rumble = { g: rg, f: rf, crackle: cg };

    if ("speechSynthesis" in window) {
      const load = () => (this.voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")));
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
    if (m && "speechSynthesis" in window) speechSynthesis.cancel();
  }
  setVoice(on: boolean) {
    this.voiceOn = on;
    if (!on && "speechSynthesis" in window) speechSynthesis.cancel();
  }

  private tone(freq: number, dur: number, gain = 0.08, type: OscillatorType = "sine", at = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  quindar(intro: boolean) {
    this.tone(intro ? 2525 : 2475, 0.25, 0.05);
  }
  chirp() {
    this.tone(1760, 0.05, 0.035, "square");
    this.tone(2350, 0.05, 0.03, "square", 0.07);
  }
  beep() {
    this.tone(1000, 0.12, 0.05, "sine");
  }
  good() {
    this.tone(880, 0.12, 0.05);
    this.tone(1320, 0.18, 0.05, "sine", 0.13);
  }
  alarm() {
    for (let i = 0; i < 4; i++) {
      this.tone(2400, 0.18, 0.06, "square", i * 0.4);
      this.tone(1900, 0.18, 0.06, "square", i * 0.4 + 0.2);
    }
  }

  /** feed audio: thrust (N) heard through the pad microphones, fading with distance */
  launch(thrustN: number, altKm: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const loud = Math.min(1, Math.log10(1 + thrustN / 2e5) / 2.2) * Math.max(0, 1 - altKm / 60);
    this.rumble.g.gain.setTargetAtTime(loud * 0.9, ctx.currentTime, 0.15);
    this.rumble.crackle.gain.setTargetAtTime(loud * 0.18, ctx.currentTime, 0.1);
    this.rumble.f.frequency.setTargetAtTime(110 + loud * 160, ctx.currentTime, 0.2);
  }

  say(text: string, who: string, radio = false) {
    if (!this.voiceOn || this.muted || !("speechSynthesis" in window) || !text) return;
    if (this.speaking > 3) {
      speechSynthesis.cancel();
      this.speaking = 0;
    }
    if (radio) this.quindar(true);
    const u = new SpeechSynthesisUtterance(text.replace(/T\+/g, "T plus ").replace(/×/g, " by "));
    if (this.voices.length) {
      let h = 0;
      for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      u.voice = this.voices[h % this.voices.length];
    }
    u.rate = 1.06;
    u.pitch = 0.9 + ((who.length * 7) % 5) / 20;
    u.volume = 0.9;
    this.speaking++;
    u.onend = u.onerror = () => {
      this.speaking = Math.max(0, this.speaking - 1);
      if (radio) this.quindar(false);
    };
    speechSynthesis.speak(u);
  }

  dispose() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void this.ctx?.close();
    this.ctx = null;
  }
}
