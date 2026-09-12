/**
 * META SIMULATION — torneio round-robin entre decks usando o MatchEngine real.
 *
 * Reutiliza o mesmo engine/IA de produção (nada de simulação especial): cada
 * partida é uma partida IA×IA determinística (seed derivada do par + índice).
 * Coleta win rate, matchup matrix, turnos médios, dano/cura/energia/cartas/KOs
 * e as cartas mais/menos usadas — o relatório alimenta o rebalanceamento.
 */
import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import { registry } from '../engine/registry';
import { findCard } from '../engine/queries';
import { expandDeck } from '../data/deckUtils';
import type { CardDef, Command } from '../engine/types';

export interface DeckEntry {
  id: string;
  name: string;
  cards: Record<string, number>;
}

export interface MatchStats {
  winner: number;
  turns: number;
  damageDealt: [number, number];
  healed: [number, number];
  cardsDrawn: [number, number];
  energiesAttached: [number, number];
  cardsPlayed: [number, number];
  kos: [number, number];
  endReason: string;
  commands: number;
}

export interface CardUsage {
  id: string;
  name: string;
  plays: number;
}

export interface SimReport {
  games: number;
  decks: { id: string; name: string }[];
  /** decks[d0.id][d1.id] → { wins, losses, games } da perspectiva de d0. */
  matrix: Record<string, Record<string, { wins: number; losses: number; games: number }>>;
  winRates: Record<string, number>;
  avgTurns: Record<string, number>;
  avgDamage: Record<string, number>;
  avgHeal: Record<string, number>;
  avgEnergies: Record<string, number>;
  avgCardsPlayed: Record<string, number>;
  avgKos: Record<string, number>;
  mostPlayed: CardUsage[];
  leastPlayed: CardUsage[];
  neverPlayed: CardUsage[];
  dominant: { deck: string; winRate: number }[];
}

export interface SimOptions {
  /** Partidas por pareamento (total = decks² × games). */
  gamesPerPair?: number;
  /** Semente base; cada partida deriva a própria seed. */
  seedBase?: number;
  /** Log detalhado por partida (para debug). */
  log?: (msg: string) => void;
  /** IA por deck (default: aiNextCommand padrão). */
  ai?: (engine: MatchEngine, pIdx: 0 | 1) => Command;
  /** Nível da IA ('normal' = heurística rápida; 'hard' = lookahead). */
  aiLevel?: 'easy' | 'normal' | 'hard';
}

const CARDS_PLAYED_EVENTS = new Set([
  'CARD_PLAYED', 'ACTION_PLAYED', 'EQUIPMENT_PLAYED', 'FIELD_PLAYED', 'ATTACK_USED',
  'RESOURCE_ATTACHED', 'CHARACTER_DEPLOYED', 'CHARACTER_UPGRADED'
]);

/** Conta uso de cartas + estatísticas da partida a partir do log do engine. */
export function collectMatchStats(engine: MatchEngine): { stats: MatchStats; usage: Record<string, number>; cardDefs: Record<string, string> } {
  const st = engine.state;
  const usage: Record<string, number> = {};
  const cardDefs: Record<string, string> = {};
  let cardsPlayed: [number, number] = [0, 0];
  let kos: [number, number] = [0, 0];
  const energies: [number, number] = [0, 0];
  for (const ev of st.log) {
    const p = ev.payload as Record<string, unknown>;
    let defId = typeof p.defId === 'string' ? p.defId : undefined;
    if (!defId && typeof p.uid === 'string') {
      const found = findCard(st, p.uid);
      if (found) defId = found.card.defId;
    }
    if (CARDS_PLAYED_EVENTS.has(ev.type)) {
      if (ev.player === 0 || ev.player === 1) cardsPlayed[ev.player]++;
      if (defId) {
        usage[defId] = (usage[defId] ?? 0) + 1;
        cardDefs[defId] = registry.tryCard(defId)?.name ?? defId;
      }
    }
    // CHARACTER_DEFEATED emite `player` = dono do agente derrotado; kos[i] = KOs DO jogador i.
    if (ev.type === 'CHARACTER_DEFEATED') kos[ev.player === 1 ? 0 : 1] += 1;
  }
  for (const p of st.players) {
    energies[p.index] = [...(p.active ? [p.active] : []), ...p.bench].reduce((s, c) => s + c.attached.filter((a) => a.kind === 'RESOURCE').length, 0);
  }
  return {
    stats: {
      winner: st.winner === 'draw' ? -1 : (st.winner ?? -1),
      turns: st.turn,
      damageDealt: st.stats.damage,
      healed: st.stats.healed,
      cardsDrawn: st.stats.cardsDrawn,
      energiesAttached: energies,
      cardsPlayed,
      kos,
      endReason: st.endReason ?? '',
      commands: st.eventSeq
    },
    usage,
    cardDefs
  };
}

/** Joga uma partida IA×IA até o fim (comandos legais, sem fallback silencioso). */
export function playAiMatch(deckA: DeckEntry, deckB: DeckEntry, seed: number, ai?: SimOptions['ai'], maxCommands = 2000, aiLevel: 'easy' | 'normal' | 'hard' = 'hard'): MatchEngine {
  const build = (d: DeckEntry): CardDef[] => expandDeck({ id: d.id, name: d.name, description: '', cards: d.cards }).map((id) => registry.card(id));
  const engine = new MatchEngine({
    seed,
    players: [
      { name: deckA.name, deckId: deckA.id, isAI: true, aiLevel, deck: build(deckA) },
      { name: deckB.name, deckId: deckB.id, isAI: true, aiLevel, deck: build(deckB) }
    ]
  });
  const cmd = ai ?? ((e: MatchEngine, p: 0 | 1) => aiNextCommand(e, p));
  // setup
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && guard++ < 40) {
      const r = engine.dispatch(cmd(engine, p));
      if (!r.ok) throw new Error(`setup ilegal p${p}: ${cmd} → ${r.error}`);
      for (;;) {
        const pend = engine.getPending();
        if (!pend) break;
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
      }
    }
  }
  let guard = 0;
  while (engine.state.phase !== 'gameOver' && guard++ < maxCommands) {
    const p = engine.state.activePlayer as 0 | 1;
    const c = cmd(engine, p);
    const r = engine.dispatch(c);
    if (!r.ok) throw new Error(`ia ilegal p${p} (${c.type}): ${r.error}`);
    for (;;) {
      const pend = engine.getPending();
      if (!pend) break;
      engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
    }
  }
  if (engine.state.phase !== 'gameOver') throw new Error('partida não terminou dentro do limite');
  return engine;
}

/** Torneio round-robin completo. */
export function simulateMeta(decks: DeckEntry[], opts: SimOptions = {}): SimReport {
  const gamesPerPair = opts.gamesPerPair ?? 8;
  const seedBase = opts.seedBase ?? 20260912;
  const log = opts.log ?? (() => {});
  const ai = opts.ai;

  const matrix: SimReport['matrix'] = {};
  const acc: Record<string, { wins: number; games: number; turns: number; damage: number; heal: number; energy: number; cards: number; kos: number }> = {};
  const usageAgg: Record<string, number> = {};
  const cardDefs: Record<string, string> = {};
  for (const d of decks) {
    matrix[d.id] = {};
    acc[d.id] = { wins: 0, games: 0, turns: 0, damage: 0, heal: 0, energy: 0, cards: 0, kos: 0 };
  }

  let game = 0;
  const totalGames = decks.length * decks.length * gamesPerPair;
  for (const a of decks) {
    for (const b of decks) {
      let wins = 0;
      let losses = 0;
      for (let i = 0; i < gamesPerPair; i++) {
        const seed = seedBase + game * 7919;
        game++;
        const engine = playAiMatch(a, b, seed, ai, 2000, opts.aiLevel ?? 'hard');
        const { stats, usage, cardDefs: cd } = collectMatchStats(engine);
        Object.assign(cardDefs, cd);
        for (const [k, n] of Object.entries(usage)) usageAgg[k] = (usageAgg[k] ?? 0) + n;
        const aWon = stats.winner === 0;
        const bWon = stats.winner === 1;
        if (aWon) wins++;
        else if (bWon) losses++;
        acc[a.id].games++;
        acc[b.id].games++;
        if (aWon) acc[a.id].wins++;
        if (bWon) acc[b.id].wins++;
        acc[a.id].turns += stats.turns;
        acc[a.id].damage += stats.damageDealt[0];
        acc[a.id].heal += stats.healed[0];
        acc[a.id].energy += stats.energiesAttached[0];
        acc[a.id].cards += stats.cardsPlayed[0];
        acc[a.id].kos += stats.kos[0];
        acc[b.id].turns += stats.turns;
        acc[b.id].damage += stats.damageDealt[1];
        acc[b.id].heal += stats.healed[1];
        acc[b.id].energy += stats.energiesAttached[1];
        acc[b.id].cards += stats.cardsPlayed[1];
        acc[b.id].kos += stats.kos[1];
        log(`[${String(game).padStart(4, '0')}/${totalGames}] ${a.id} vs ${b.id} → ${aWon ? a.id : bWon ? b.id : 'draw'} (${stats.turns} turnos)`);
      }
      matrix[a.id][b.id] = { wins, losses, games: gamesPerPair };
    }
  }

  const winRates: Record<string, number> = {};
  const avgTurns: Record<string, number> = {};
  const avgDamage: Record<string, number> = {};
  const avgHeal: Record<string, number> = {};
  const avgEnergies: Record<string, number> = {};
  const avgCardsPlayed: Record<string, number> = {};
  const avgKos: Record<string, number> = {};
  for (const d of decks) {
    const a = acc[d.id];
    winRates[d.id] = a.games > 0 ? a.wins / a.games : 0;
    avgTurns[d.id] = a.games > 0 ? a.turns / a.games : 0;
    avgDamage[d.id] = a.games > 0 ? a.damage / a.games : 0;
    avgHeal[d.id] = a.games > 0 ? a.heal / a.games : 0;
    avgEnergies[d.id] = a.games > 0 ? a.energy / a.games : 0;
    avgCardsPlayed[d.id] = a.games > 0 ? a.cards / a.games : 0;
    avgKos[d.id] = a.games > 0 ? a.kos / a.games : 0;
  }

  const played = Object.entries(usageAgg).sort((x, y) => y[1] - x[1]).map(([id, plays]) => ({ id, name: cardDefs[id] ?? id, plays }));
  // "nunca usadas" = cartas que EXISTEM nos decks simulados mas não foram jogadas
  const deckPool = new Set<string>();
  for (const d of decks) for (const id of Object.keys(d.cards)) deckPool.add(id);
  const neverPlayed = registry.allCards()
    .filter((c) => deckPool.has(c.id) && !(c.id in usageAgg))
    .map((c) => ({ id: c.id, name: c.name, plays: 0 }));

  const dominant = decks
    .filter((d) => winRates[d.id] > 0.65)
    .map((d) => ({ deck: d.id, winRate: winRates[d.id] }));

  return {
    games: game,
    decks: decks.map((d) => ({ id: d.id, name: d.name })),
    matrix,
    winRates,
    avgTurns,
    avgDamage,
    avgHeal,
    avgEnergies,
    avgCardsPlayed,
    avgKos,
    mostPlayed: played.slice(0, 20),
    leastPlayed: played.slice(-20).reverse(),
    neverPlayed,
    dominant
  };
}

/** Formata o relatório em markdown (usado no script CLI e no docs). */
export function formatSimReport(report: SimReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`## Meta Simulation — ${report.games} partidas (${report.decks.length} decks)`);
  lines.push('');
  lines.push('### Win rates');
  lines.push('| Deck | Win rate | Turnos médios | Dano sofrido | Cura média | Energias | KOs |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const d of report.decks) {
    lines.push(`| ${d.name} | ${pct(report.winRates[d.id])} | ${report.avgTurns[d.id].toFixed(1)} | ${report.avgDamage[d.id].toFixed(0)} | ${report.avgHeal[d.id].toFixed(0)} | ${report.avgEnergies[d.id].toFixed(1)} | ${report.avgKos[d.id].toFixed(1)} |`);
  }
  lines.push('');
  lines.push('### Matchup matrix (linha = perspectiva da coluna de cima)');
  const header = ['', ...report.decks.map((d) => d.name)];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('|' + header.map(() => '---').join('|') + '|');
  for (const a of report.decks) {
    const row = [a.name];
    for (const b of report.decks) {
      const cell = report.matrix[a.id][b.id];
      row.push(cell ? `${pct(cell.wins / (cell.games || 1))}` : '—');
    }
    lines.push('| ' + row.join(' | ') + ' |');
  }
  lines.push('');
  lines.push('### Cartas mais usadas');
  lines.push(report.mostPlayed.map((c) => `- ${c.name} (${c.id}): ${c.plays}×`).join('\n'));
  lines.push('');
  lines.push('### Cartas menos usadas');
  lines.push(report.leastPlayed.map((c) => `- ${c.name} (${c.id}): ${c.plays}×`).join('\n'));
  lines.push('');
  lines.push('### Cartas nunca usadas');
  lines.push(report.neverPlayed.length ? report.neverPlayed.map((c) => `- ${c.name} (${c.id})`).join('\n') : '- nenhuma');
  if (report.dominant.length) {
    lines.push('');
    lines.push('### ⚠️ Dominância universal (>65% contra o field inteiro)');
    for (const d of report.dominant) lines.push(`- ${d.deck}: ${pct(d.winRate)}`);
  }
  return lines.join('\n');
}
