/**
 * Trilha e efeitos sonoros do vídeo de aniversário.
 *
 * A trilha é um ARQUIVO de verdade (`/audio/birthday-theme.mp3`). Três
 * tentativas de sintetizar a música com Web Audio soaram artificiais: melodia
 * sintetizada é implacável, cada nota expõe o timbre falso. Instrumento
 * gravado resolve isso de uma vez.
 *
 * Já os EFEITOS continuam sintetizados, e aí a síntese é a escolha certa:
 * whoosh, impacto e brilhos são ruído filtrado e envelopes — não imitam
 * instrumento nenhum, soam como efeito mesmo, e evitam mais quatro arquivos no
 * bundle. São disparados pelo vídeo em `cue()`.
 *
 * Trilha: Canon (Pachelbel) pela United States Air Force Band — domínio
 * público. Ver `public/audio/birthday-theme.LICENSE.txt`. Para trocar a
 * música basta substituir o arquivo; nada aqui precisa mudar.
 */

const BPM = 100;
export const BEAT = 60 / BPM; // 0,6 s
export const BAR = BEAT * 3;
export const MUSIC_DURATION = BEAT * 80; // 48 s

/** Instante do clímax — o vídeo alinha o confete a ele. */
export const MUSIC_CLIMAX_BEAT = 46;
export const MUSIC_CLIMAX_AT = BEAT * MUSIC_CLIMAX_BEAT; // 27,6 s

export const BIRTHDAY_THEME_URL = '/audio/birthday-theme.mp3';

/** Volume da trilha. Os efeitos têm barramento próprio, mais alto. */
const THEME_LEVEL = 0.55;
const FADE_IN = 2;
const FADE_OUT = 3.5;

export type SoundCue = 'whoosh' | 'impact' | 'sparkle' | 'chime' | 'rise';

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class BirthdayMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private themeGain: GainNode | null = null;
  private themeSource: AudioBufferSourceNode | null = null;
  private fxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private startedAt = 0;
  private muted = false;
  private started = false;
  private disposed = false;

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Posição do áudio, ou null quando não há som. NÃO serve como relógio do
   * vídeo: o navegador suspende o AudioContext sozinho (aba oculta, tela
   * bloqueada, autoplay do iOS) e isso congelaria a animação inteira.
   */
  audioTime(): number | null {
    if (!this.ctx || !this.started) return null;
    return Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /** Retoma o áudio se o navegador o tiver suspendido por conta própria. */
  resumeIfSuspended(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  /** Precisa ser chamado dentro de um gesto do usuário (clique). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const AudioCtor: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    try {
      const ctx = new AudioCtor();
      if (ctx.state === 'suspended') await ctx.resume();
      if (this.disposed) {
        void ctx.close().catch(() => {});
        return;
      }
      this.ctx = ctx;
      this.startedAt = ctx.currentTime;

      const noiseLength = Math.floor(ctx.sampleRate * 2);
      const noise = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < noiseLength; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = noise;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(ctx.destination);
      this.master = master;

      const reverb = ctx.createConvolver();
      reverb.buffer = this.createReverbImpulse(ctx);
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0.35;
      reverb.connect(reverbGain).connect(master);

      // Os efeitos passam pelo reverb; a trilha já vem com o ambiente da
      // gravação e ficaria embolada se recebesse mais.
      const fxBus = ctx.createGain();
      fxBus.gain.value = 0.8;
      fxBus.connect(master);
      fxBus.connect(reverb);
      this.fxBus = fxBus;

      const themeGain = ctx.createGain();
      themeGain.gain.value = 0.0001;
      themeGain.connect(master);
      this.themeGain = themeGain;

      // Os efeitos já funcionam mesmo se a trilha demorar ou falhar.
      void this.loadTheme();
    } catch {
      this.ctx = null;
    }
  }

  /** Baixa e decodifica a trilha. Falhar aqui não quebra nada: sobram os efeitos. */
  private async loadTheme(): Promise<void> {
    const ctx = this.ctx;
    const themeGain = this.themeGain;
    if (!ctx || !themeGain) return;

    try {
      const response = await fetch(BIRTHDAY_THEME_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const encoded = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(encoded);
      if (this.disposed || !this.ctx) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(themeGain);

      const now = ctx.currentTime;
      const playable = Math.min(buffer.duration, MUSIC_DURATION + FADE_OUT);

      themeGain.gain.cancelScheduledValues(now);
      themeGain.gain.setValueAtTime(0.0001, now);
      themeGain.gain.linearRampToValueAtTime(THEME_LEVEL, now + FADE_IN);
      themeGain.gain.setValueAtTime(THEME_LEVEL, now + Math.max(FADE_IN, playable - FADE_OUT));
      themeGain.gain.linearRampToValueAtTime(0.0001, now + playable);

      source.start(now);
      source.stop(now + playable + 0.2);
      this.themeSource = source;
    } catch (error) {
      console.warn('Trilha do aniversário não pôde ser carregada:', error);
    }
  }

  private createReverbImpulse(ctx: AudioContext, seconds = 2.6, decay = 2.4): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
      }
    }
    return impulse;
  }

  // -----------------------------------------------------------------------
  // Efeitos sonoros — disparados pelo vídeo
  // -----------------------------------------------------------------------

  /** Dispara um efeito pontual. Ignorado silenciosamente se não houver áudio. */
  cue(name: SoundCue): void {
    const ctx = this.ctx;
    const fx = this.fxBus;
    if (!ctx || !fx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (name === 'whoosh') this.whoosh(fx, now);
    if (name === 'rise') this.riser(fx, now, 1.6);
    if (name === 'impact') this.impact(fx, now);
    if (name === 'sparkle') this.sparkleBurst(fx, now);
    if (name === 'chime') this.chime(fx, now);
  }

  /** Passagem de ar nas viradas de cena, cruzando o estéreo. */
  private whoosh(target: AudioNode, time: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const duration = 0.9;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(320, time);
    filter.frequency.exponentialRampToValueAtTime(3000, time + duration * 0.55);
    filter.frequency.exponentialRampToValueAtTime(520, time + duration);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-0.7, time);
    panner.pan.linearRampToValueAtTime(0.7, time + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.1, time + duration * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.connect(filter).connect(panner).connect(gain).connect(target);
    source.start(time);
    source.stop(time + duration + 0.05);
  }

  private riser(target: AudioNode, time: number, duration: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(5600, time + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.12, time + duration * 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.15);

    source.connect(filter).connect(gain).connect(target);
    source.start(time);
    source.stop(time + duration + 0.25);
  }

  /** Impacto grave do clímax. */
  private impact(target: AudioNode, time: number) {
    const ctx = this.ctx;
    if (!ctx) return;

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, time);
    sub.frequency.exponentialRampToValueAtTime(36, time + 0.7);
    subGain.gain.setValueAtTime(0.0001, time);
    subGain.gain.linearRampToValueAtTime(0.4, time + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.0001, time + 1.5);
    sub.connect(subGain).connect(target);
    sub.start(time);
    sub.stop(time + 1.6);

    if (!this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5000, time);
    filter.frequency.exponentialRampToValueAtTime(400, time + 1.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.3);
    source.connect(filter).connect(gain).connect(target);
    source.start(time);
    source.stop(time + 1.4);
  }

  /** Chuvinha de brilhos, acompanhando o confete. */
  private sparkleBurst(target: AudioNode, time: number) {
    [96, 100, 103, 108, 96, 105, 112, 100].forEach((midi, index) => {
      this.shimmer(target, time + index * 0.075 + Math.random() * 0.03, midi, 0.3);
    });
  }

  /** Sino do encerramento. */
  private chime(target: AudioNode, time: number) {
    [72, 76, 79, 84].forEach((midi, index) => {
      this.shimmer(target, time + index * 0.16, midi, 0.36);
    });
  }

  /** Brilho: senoide aguda com cauda longa. */
  private shimmer(target: AudioNode, time: number, midi: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || time < ctx.currentTime - 0.05) return;
    const freq = midiToFreq(midi);
    if (freq > ctx.sampleRate / 2.2) return;

    const panner = ctx.createStereoPanner();
    panner.pan.value = ((midi % 5) - 2) / 5;
    panner.connect(target);

    [
      { ratio: 1, gain: 1, decay: 2.4 },
      { ratio: 2, gain: 0.26, decay: 1.2 },
    ].forEach((partial) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(level * partial.gain * 0.16, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + partial.decay);
      gain.connect(panner);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * partial.ratio;
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + partial.decay + 0.05);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (paused && ctx.state === 'running') await ctx.suspend();
      if (!paused && ctx.state === 'suspended') await ctx.resume();
    } catch {
      // ignore
    }
  }

  stop(): void {
    const ctx = this.ctx;
    this.disposed = true;
    try {
      this.themeSource?.stop();
    } catch {
      // já parado
    }
    this.themeSource = null;
    this.themeGain = null;
    this.ctx = null;
    this.master = null;
    this.fxBus = null;
    this.started = false;
    if (ctx) void ctx.close().catch(() => {});
  }
}
