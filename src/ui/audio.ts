/**
 * JET TCG — efeitos sonoros leves gerados por Web Audio.
 *
 * Nenhum asset externo, nenhuma biblioteca: tons simples sintetizados.
 * - Nunca é requisito para jogar (falha silenciosa se o navegador bloquear).
 * - Respeita a preferência `soundEnabled` dos Ajustes.
 * - Nunca cria o `AudioContext` antes de um gesto do usuário (política de
 *   autoplay dos navegadores).
 */

import type { SfxName } from '../game/cues';

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

interface ToneSpec {
  freq: number;
  to?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

const SPEC: Record<SfxName, ToneSpec[]> = {
  play: [{ freq: 420, to: 640, duration: 0.1, type: 'triangle', gain: 0.1 }],
  ui: [{ freq: 560, duration: 0.05, type: 'sine', gain: 0.05 }],
  attack: [
    { freq: 300, to: 120, duration: 0.14, type: 'sawtooth', gain: 0.11 },
    { freq: 90, duration: 0.18, type: 'square', gain: 0.06, delay: 0.03 }
  ],
  damage: [{ freq: 200, to: 90, duration: 0.16, type: 'square', gain: 0.09 }],
  heal: [
    { freq: 520, duration: 0.12, type: 'sine', gain: 0.07 },
    { freq: 780, duration: 0.14, type: 'sine', gain: 0.06, delay: 0.08 }
  ],
  ko: [
    { freq: 180, to: 60, duration: 0.3, type: 'sawtooth', gain: 0.12 },
    { freq: 70, duration: 0.34, type: 'square', gain: 0.07, delay: 0.05 }
  ],
  vp: [
    { freq: 523, duration: 0.12, type: 'triangle', gain: 0.09 },
    { freq: 659, duration: 0.12, type: 'triangle', gain: 0.09, delay: 0.1 },
    { freq: 784, duration: 0.2, type: 'triangle', gain: 0.1, delay: 0.2 }
  ],
  error: [{ freq: 180, to: 120, duration: 0.14, type: 'square', gain: 0.07 }]
};

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof Ctor !== 'function') return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Toca um efeito. Silencioso e seguro em qualquer ambiente. */
export function playSfx(name: SfxName): void {
  if (!enabled) return;
  const audio = context();
  if (!audio) return;
  const specs = SPEC[name] ?? SPEC.ui;
  const base = audio.currentTime;
  for (const spec of specs) {
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = spec.type ?? 'sine';
      const start = base + (spec.delay ?? 0);
      osc.frequency.setValueAtTime(spec.freq, start);
      if (spec.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), start + spec.duration);
      const peak = spec.gain ?? 0.08;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + spec.duration + 0.02);
    } catch {
      // Áudio é cosmético — nunca pode quebrar o jogo.
    }
  }
}
