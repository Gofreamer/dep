/**
 * JET TCG — eventos do engine → sinais visuais (cues).
 *
 * Extraído do `MatchController` para ser compartilhado com o multiplayer:
 * a mesma tradução evento→feedback é usada no modo IA/local e no online.
 * Nada aqui muda o estado do jogo — são apenas ecos visuais do que o engine
 * JÁ resolveu (a engine continua sendo a única fonte da verdade).
 */

import type { GameEvent, PlayerId } from '../engine/types';
import type { Cue } from './controller';

export type CueSeed = Omit<Cue, 'id'>;

/** Traduz eventos públicos em cues. Puro e determinístico. */
export function cuesFromEvents(events: GameEvent[]): CueSeed[] {
  const out: CueSeed[] = [];
  for (const ev of events) {
    const p = ev.payload as Record<string, any>;
    switch (ev.type) {
      case 'DAMAGE_DEALT':
        if (!p.preview && p.uid && p.amount > 0) out.push({ kind: 'damage', uid: p.uid, text: `-${p.amount}`, big: p.amount >= 50 });
        break;
      case 'HEALED':
        if (p.uid && p.amount > 0) out.push({ kind: 'heal', uid: p.uid, text: `+${p.amount}` });
        break;
      case 'CHARACTER_DEFEATED':
        out.push({ kind: 'ko', uid: p.uid, text: 'DERROTADO' });
        out.push({ kind: 'shake' });
        break;
      case 'ATTACK_USED':
        out.push({ kind: 'attack', uid: p.uid });
        break;
      case 'CHARACTER_UPGRADED':
        out.push({ kind: 'upgrade', uid: p.uid, text: 'EVOLUIU!' });
        break;
      case 'STATUS_APPLIED':
        out.push({ kind: 'status', uid: p.uid, text: String(p.status ?? '') });
        break;
      case 'VICTORY_POINTS_CHANGED':
        out.push({ kind: 'vp', player: (ev.player ?? undefined) as PlayerId | undefined, text: `+${p.amount} PV` });
        break;
      case 'COIN_FLIPPED':
        out.push({ kind: 'coin', text: p.success ? '✦ Cara!' : '✧ Coroa' });
        break;
      case 'MATCH_ENDED':
        out.push({ kind: 'shake', big: true });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Sons leves (Web Audio) para os cues principais — opcionais e mutáveis. */
export type SfxName = 'play' | 'attack' | 'damage' | 'heal' | 'ko' | 'vp' | 'ui' | 'error';

export function sfxForCue(cue: CueSeed): SfxName | null {
  switch (cue.kind) {
    case 'attack': return 'attack';
    case 'damage': return 'damage';
    case 'heal': return 'heal';
    case 'ko': return 'ko';
    case 'vp': return 'vp';
    case 'upgrade': return 'play';
    case 'status': return 'ui';
    default: return null;
  }
}
