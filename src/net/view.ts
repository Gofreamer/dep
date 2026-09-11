/**
 * JET TCG — visão pública de partida (`PublicMatchView`).
 *
 * O servidor roda o `MatchState` completo e autoritativo. NUNCA o envia
 * inteiro aos dois clientes: este módulo projeta, para um observador, apenas o
 * que ele tem direito de saber.
 *
 * Público: próprio lado integral (mão, baralho, descarte, campo), campo do
 * adversário (ativo, reserva, anexos, status, contadores), descarte do
 * adversário, contagens de mão/baralho do adversário, campos, PV, turno, fase,
 * resultado.
 *
 * Oculto: conteúdo e ORDEM do baralho adversário, mão adversária, escolhas
 * pendentes do adversário, `seed`/`rngState` (permitiriam prever o
 * embaralhamento) e `defId` de compras do adversário no log.
 *
 * Puro e determinístico — usado pelo Worker e coberto por testes.
 */

import type { CardInstance, GameEvent, MatchState, PlayerId } from '../engine/types';
import type { PublicMatchView } from './protocol';

export type { PublicMatchView };

/**
 * Eventos cujo payload revela carta OCULTA e precisam ser filtrados para o
 * outro observador. `CARD_DRAWN` carrega `defId`; os demais só identificam
 * uids (não secretos), então bastam ter o `defId` removido.
 */
const HIDES_DEF_ID: ReadonlySet<string> = new Set(['CARD_DRAWN']);

/** Zonas ocultas expostas apenas como contagem. */
function zoneCounts(p: { hand: CardInstance[]; deck: CardInstance[] }): { hand: number; deck: number } {
  return { hand: p.hand.length, deck: p.deck.length };
}

/**
 * Sanitiza o log para UM observador. Regras:
 *  - eventos do próprio observador passam intactos (ele conhece suas cartas);
 *  - eventos do adversário perdem `defId` quando o evento revela compra;
 *  - `CHOICE_REQUESTED` do adversário é removido (revelaria candidatos);
 *  - eventos neutros (`player: null`) passam.
 */
export function sanitizeLogFor(log: GameEvent[], viewer: PlayerId): GameEvent[] {
  const out: GameEvent[] = [];
  for (const ev of log) {
    if (ev.player === viewer || ev.player === null) {
      out.push(ev);
      continue;
    }
    if (ev.type === 'CHOICE_REQUESTED') continue;
    if (HIDES_DEF_ID.has(ev.type) && ev.payload && 'defId' in ev.payload) {
      const payload: Record<string, unknown> = { ...ev.payload };
      delete payload.defId;
      out.push({ ...ev, payload });
      continue;
    }
    out.push(ev);
  }
  return out;
}

/**
 * Gera a visão de partida para `viewer`. O estado original NÃO é mutado: a
 * projeção clona só o que precisa divergir (jogadores e log).
 */
export function viewForPlayer(state: MatchState, viewer: PlayerId): PublicMatchView {
  const opponent = (viewer === 0 ? 1 : 0) as PlayerId;
  const players = [state.players[0], state.players[1]].map((p, i) => {
    if ((i as PlayerId) === viewer) return p;
    // Adversário: campo/descarte públicos; mão e baralho saem VAZIOS.
    return { ...p, hand: [] as CardInstance[], deck: [] as CardInstance[] };
  }) as MatchState['players'];

  return {
    ...state,
    players,
    log: sanitizeLogFor(state.log, viewer),
    // Seed/RNG nunca vazam: permitiriam reconstruir a ordem do baralho.
    seed: 0,
    rngState: 0,
    viewer,
    hidden: zoneCounts(state.players[opponent])
  };
}

/**
 * Verdadeiro quando a visão NÃO contém informação privada do outro jogador.
 * Usada como invariante em testes (prova anti-vazamento).
 */
export function viewLeaksNothingOf(state: MatchState, view: PublicMatchView): boolean {
  const viewer = view.viewer;
  const opponent = (viewer === 0 ? 1 : 0) as PlayerId;
  if (view.players[opponent].hand.length !== 0) return false;
  if (view.players[opponent].deck.length !== 0) return false;
  if (view.seed !== 0 || view.rngState !== 0) return false;
  if (view.hidden.hand !== state.players[opponent].hand.length) return false;
  if (view.hidden.deck !== state.players[opponent].deck.length) return false;
  const known = new Set(state.players[opponent].hand.map((c) => c.uid));
  for (const ev of view.log) {
    if (ev.player !== opponent) continue;
    if (ev.type === 'CHOICE_REQUESTED') return false;
    if (ev.type === 'CARD_DRAWN' && 'defId' in (ev.payload ?? {})) return false;
    if (ev.type === 'CARD_DRAWN' && known.has(String(ev.payload?.uid ?? ''))) {
      // uid de carta da mão adversária pode aparecer, mas sem defId não há vazamento
    }
  }
  return true;
}

/** Serialização compacta: remove campos que a UI não usa na rede. */
export function compactView(view: PublicMatchView): PublicMatchView {
  return { ...view, log: view.log.slice(-120) };
}
