/**
 * META SIMULATION — torneio round-robin entre decks usando o MatchEngine real.
 *
 * Reutiliza o mesmo engine/IA de produção (nada de simulação especial): cada
 * partida é IA×IA determinística. Coleta win rate, matriz de matchup, split de
 * quem começa (P0/P1), turnos, dano/cura/energia/KOs e uso de cartas.
 *
 * Estatística (2.1): o torneio roda `seeds` replicações independentes e reporta
 * média, desvio-padrão entre replicações e intervalo de 95% aproximado por deck.
 * A matriz é derivada de UM conjunto de partidas por par (A×B), com os dois
 * assentos alternados — portanto `matrix[A][B] + matrix[B][A] === 1` por
 * construção (verificação explícita em `assertMatrixConsistent`).
 */
import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import { registry } from '../engine/registry';
import { findCard } from '../engine/queries';
import { expandDeck } from '../data/deckUtils';
import type { AiProfile } from '../engine/ai/profile';
import type { AiLevel } from '../engine/types';
import type { CardDef, Command, GameEvent, MatchState } from '../engine/types';

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
  /** Maior sequência de turnos sem nenhum KO (detector de jogo travado). */
  longestKoless: number;
  /** Turno em que o primeiro KO aconteceu (0 = nenhum). */
  firstKoTurn: number;
  endReason: string;
  commands: number;
}

export interface CardUsage {
  id: string;
  name: string;
  plays: number;
  /** Vezes em que a carta esteve na mão (aproxima "foi comprada"). */
  inHand: number;
  /** Ratio jogada/comprada (0 = comprada e nunca usada; 1 = sempre usada). */
  playRate: number;
}

export interface PairCell {
  wins: number;
  losses: number;
  games: number;
  draws: number;
  /** Vitórias do deck da linha quando ele abriu (P0) / quando fechou (P1). */
  winsAsP0: number;
  gamesAsP0: number;
  winsAsP1: number;
  gamesAsP1: number;
  avgTurns: number;
}

export interface SimReport {
  games: number;
  seeds: number[];
  decks: { id: string; name: string }[];
  /** matrix[a][b] = perspectiva de `a` no conjunto de partidas de {a,b}. */
  matrix: Record<string, Record<string, PairCell>>;
  winRates: Record<string, number>;
  /** por deck: win rate de cada replicação (uma por seed) */
  winRatesBySeed: Record<string, number[]>;
  sd: Record<string, number>;
  ci95: Record<string, [number, number]>;
  avgTurns: Record<string, number>;
  turnSd: Record<string, number>;
  avgDamage: Record<string, number>;
  avgHeal: Record<string, number>;
  avgEnergies: Record<string, number>;
  avgCardsPlayed: Record<string, number>;
  avgKos: Record<string, number>;
  /** % de partidas em que o deck venceu abrindo (P0) / fechando (P1). */
  p0WinRate: Record<string, number>;
  p1WinRate: Record<string, number>;
  p0Games: Record<string, number>;
  p1Games: Record<string, number>;
  /** % de todas as partidas (incl. espelhos) vencidas por P0 / P1. */
  firstPlayer: {
    p0Wins: number; p1Wins: number; draws: number; games: number;
    /** espelhos isolados: única forma de medir o efeito PURO do assento. */
    mirrorP0Wins: number; mirrorGames: number;
    /**
     * Quem COMEÇOU o jogo (sorteado pelo engine) vs vencedor. Separa as duas
     * coisas que o número de assento sozinha confunde: vantagem de regra
     * (começar) e acoplamento de RNG/embaralhamento com assento (medição).
     */
    starterWins: number; starterGames: number;
    mirrorStarterWins: number; mirrorStarterGames: number;
  };
  /** Partidas por par e por célula de espelho (para ler σ das taxas). */
  gamesPerPair: number;
  /** 'paired-seats' = cada par de partidas troca de assento na MESMA seed. */
  design: 'paired-seats' | 'paired-seats-last-odd' | 'alternating';
  /** média de "maior período sem KO" por deck (jogo travado). */
  avgKoless: Record<string, number>;
  avgFirstKoTurn: Record<string, number>;
  mostPlayed: CardUsage[];
  leastPlayed: CardUsage[];
  neverPlayed: CardUsage[];
  /** cartas compradas com frequência mas quase nunca jogadas (candidatas a corte). */
  deadInHand: CardUsage[];
  dominant: { deck: string; winRate: number }[];
  weak: { deck: string; winRate: number }[];
  mirror: Record<string, number>;
  /** divergência máxima de `matrix[a][b] + matrix[b][a]` em relação a 1. */
  matrixSkew: number;
  /** matchups diretos fora da faixa [0.2, 0.8] — "sem counterplay". */
  brutalMatchups: { a: string; b: string; rate: number }[];
}

export interface SimOptions {
  /** Partidas por PAREAMENTO (par não ordenado, assentos alternados). */
  gamesPerPair?: number;
  /**
   * Bases de seed independentes; cada uma reproduz o torneio inteiro.
   * `seedBase` continua suportado (replicação única).
   */
  seeds?: number[];
  seedBase?: number;
  log?: (msg: string) => void;
  /** Fábrica de IA por assento — permite perfis por deck (bots individuais). */
  ai?: (engine: MatchEngine, pIdx: 0 | 1) => Command;
  /** Perfil por deck: `aiFor(deckId)` vence `aiLevel`. */
  aiFor?: (deckId: string) => AiProfile | undefined;
  aiLevel?: AiLevel;
  victoryTarget?: number;
  /** Teto de comandos por partida (partidas sem fim são erro, não empate). */
  maxCommands?: number;
}

const CARDS_PLAYED_EVENTS = new Set([
  'CARD_PLAYED', 'ACTION_PLAYED', 'EQUIPMENT_PLAYED', 'FIELD_PLAYED', 'ATTACK_USED',
  'RESOURCE_ATTACHED', 'CHARACTER_DEPLOYED', 'CHARACTER_UPGRADED'
]);

/** Conta uso de cartas + estatísticas da partida a partir do log do engine. */
/**
 * `events` deve ser a lista COMPLETA da partida. O log do estado tem teto
 * (3000 eventos) e truncar os primeiros turnos enviesaria exatamente o que
 * estamos medindo (curva inicial / uso de cartas).
 */
export function collectMatchStats(engine: MatchEngine, events?: GameEvent[]): { stats: MatchStats; usage: Record<string, number>; inHand: Record<string, number>; cardDefs: Record<string, string> } {
  const st = engine.state;
  const usage: Record<string, number> = {};
  const inHand: Record<string, number> = {};
  const cardDefs: Record<string, string> = {};
  let cardsPlayed: [number, number] = [0, 0];
  const kos: [number, number] = [0, 0];
  const energies: [number, number] = [0, 0];
  let lastKoTurn = 0;
  let longestKoless = 0;
  let firstKoTurn = 0;
  for (const ev of events ?? st.log) {
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
    if (ev.type === 'CARD_DRAWN' && typeof p.defId === 'string') {
      inHand[p.defId] = (inHand[p.defId] ?? 0) + 1;
    }
    // CHARACTER_DEFEATED emite `player` = dono do agente derrotado; kos[i] = KOs DO jogador i.
    if (ev.type === 'CHARACTER_DEFEATED') {
      const victim = ev.player === 1 ? 0 : 1;
      kos[victim] += 1;
      longestKoless = Math.max(longestKoless, ev.turn - lastKoTurn);
      if (!firstKoTurn) firstKoTurn = ev.turn;
      lastKoTurn = ev.turn;
    }
  }
  for (const p of st.players) {
    energies[p.index] = [...(p.active ? [p.active] : []), ...p.bench].reduce((s, c) => s + c.attached.filter((a) => a.kind === 'RESOURCE').length, 0);
  }
  longestKoless = Math.max(longestKoless, st.turn - lastKoTurn);
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
      longestKoless,
      firstKoTurn,
      endReason: st.endReason ?? '',
      commands: st.eventSeq
    },
    usage,
    inHand,
    cardDefs
  };
}

/**
 * Joga uma partida IA×IA até o fim (comandos legais, sem fallback silencioso:
 * IA que gera comando ilegal ou partida sem fim é ERRO, não empate).
 * Devolve também a lista completa de eventos (o log do estado tem teto).
 */
export interface AiMatchArgs {
  deckA: DeckEntry;
  deckB: DeckEntry;
  seed: number;
  ai?: SimOptions['ai'];
  maxCommands?: number;
  aiLevel?: AiLevel;
  victoryTarget?: number;
  profiles?: [AiProfile | undefined, AiProfile | undefined];
}

export function runAiMatch(args: AiMatchArgs): { engine: MatchEngine; events: GameEvent[] } {
  const { deckA, deckB, seed, ai, victoryTarget, profiles } = args;
  const maxCommands = args.maxCommands ?? 2000;
  const aiLevel = args.aiLevel ?? 'hard';
  const build = (d: DeckEntry): CardDef[] => expandDeck({ id: d.id, name: d.name, description: '', cards: d.cards }).map((id) => registry.card(id));
  const engine = new MatchEngine({
    seed,
    players: [
      { name: deckA.name, deckId: deckA.id, isAI: true, aiLevel, deck: build(deckA) },
      { name: deckB.name, deckId: deckB.id, isAI: true, aiLevel, deck: build(deckB) }
    ],
    config: victoryTarget !== undefined ? { victory: { targetPoints: victoryTarget } } : undefined
  });
  const profA = profiles?.[0];
  const profB = profiles?.[1];
  const cmd = ai ?? ((e: MatchEngine, p: 0 | 1) => aiNextCommand(e, p, p === 0 ? profA : profB));

  const events: GameEvent[] = [];
  let seen = -1;
  const drain = (): void => {
    const log = engine.state.log;
    if (log.length === 0) return;
    const firstSeq = log[0].seq;
    // log truncado: nada a recuperar além do que ainda está lá
    const from = Math.max(seen + 1, firstSeq);
    for (const ev of log) {
      if (ev.seq < from) continue;
      events.push(ev);
      seen = ev.seq;
    }
  };
  const resolvePending = (): void => {
    for (;;) {
      const pend = engine.getPending();
      if (!pend) break;
      engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
      drain();
    }
  };
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && guard++ < 40) {
      const r = engine.dispatch(cmd(engine, p));
      if (!r.ok) throw new Error(`setup ilegal p${p}: ${r.error}`);
      drain();
      resolvePending();
    }
  }
  let guard = 0;
  while (engine.state.phase !== 'gameOver' && guard++ < maxCommands) {
    const p = engine.state.activePlayer as 0 | 1;
    const c = cmd(engine, p);
    const r = engine.dispatch(c);
    if (!r.ok) throw new Error(`ia ilegal p${p} (${c.type}): ${r.error}`);
    drain();
    resolvePending();
  }
  drain();
  if (engine.state.phase !== 'gameOver') throw new Error('partida não terminou dentro do limite');
  return { engine, events };
}

/** Compat: mesma chamada antiga, retornando só o engine. */
export function playAiMatch(
  deckA: DeckEntry,
  deckB: DeckEntry,
  seed: number,
  ai?: SimOptions['ai'],
  maxCommands = 2000,
  aiLevel: AiLevel = 'hard',
  victoryTarget?: number,
  profiles?: [AiProfile | undefined, AiProfile | undefined]
): MatchEngine {
  return runAiMatch({ deckA, deckB, seed, ai, maxCommands, aiLevel, victoryTarget, profiles }).engine;
}

interface DeckAcc {
  wins: number; games: number; turns: number; turns2: number; damage: number; heal: number;
  energy: number; cards: number; kos: number; koless: number; firstKo: number; firstKoGames: number;
  p0Wins: number; p0Games: number; p1Wins: number; p1Games: number;
}

const emptyAcc = (): DeckAcc => ({
  wins: 0, games: 0, turns: 0, turns2: 0, damage: 0, heal: 0, energy: 0, cards: 0, kos: 0, koless: 0,
  firstKo: 0, firstKoGames: 0, p0Wins: 0, p0Games: 0, p1Wins: 0, p1Games: 0
});

/** Torneio round-robin completo (par não ordenado, assentos alternados). */
export function simulateMeta(decks: DeckEntry[], opts: SimOptions = {}): SimReport {
  const gamesPerPair = Math.max(2, opts.gamesPerPair ?? 16);
  const seeds = (opts.seeds && opts.seeds.length ? opts.seeds : [opts.seedBase ?? 20260912]);
  const log = opts.log ?? (() => {});
  const ai = opts.ai;
  const aiLevel = opts.aiLevel ?? 'hard';
  const maxCommands = opts.maxCommands ?? 2000;
  const profileOf = (deckId: string): AiProfile | undefined => opts.aiFor?.(deckId);

  const matrix: SimReport['matrix'] = {};
  const acc: Record<string, DeckAcc> = {};
  const usageAgg: Record<string, number> = {};
  const inHandAgg: Record<string, number> = {};
  const cardDefs: Record<string, string> = {};
  const seedWins: Record<string, number[]> = {};
  const seedGames: Record<string, number[]> = {};
  for (const d of decks) {
    matrix[d.id] = {};
    acc[d.id] = emptyAcc();
    seedWins[d.id] = new Array(seeds.length).fill(0);
    seedGames[d.id] = new Array(seeds.length).fill(0);
  }

  const pairs: [DeckEntry, DeckEntry][] = [];
  for (let i = 0; i < decks.length; i++) for (let j = i; j < decks.length; j++) pairs.push([decks[i], decks[j]]);

  const totalGames = pairs.length * gamesPerPair * seeds.length;
  let game = 0;
  const firstPlayer = { p0Wins: 0, p1Wins: 0, draws: 0, games: 0, mirrorP0Wins: 0, mirrorGames: 0, starterWins: 0, starterGames: 0, mirrorStarterWins: 0, mirrorStarterGames: 0 };
  let pairNo = 0;

  for (const [a, b] of pairs) {
    const isMirror = a.id === b.id;
    let wins = 0, losses = 0, draws = 0, turnsSum = 0, cellGames = 0;
    let aP0 = 0, aP0wins = 0, aP1 = 0, aP1wins = 0;

    for (let si = 0; si < seeds.length; si++) {
      const base = seeds[si];
      for (let i = 0; i < gamesPerPair; i++) {
        // DELINEAMENTO PAREADO: os jogos (2m, 2m+1) usam a MESMA semente com
        // os assentos trocados. Com `seed = base + game*7919` e alternância
        // por `i % 2`, "estar em P0" ficava perfeitamente correlacionado à
        // paridade do índice global do jogo — e qualquer sensibilidade do RNG
        // à paridade da semente aparecia como "viés de assento" de 10+ pp.
        // Baralho e vantagem de primeiro turno são as únicas coisas que mudam.
        const rep = i >> 1;
        const aFirst = i % 2 === 0;
        const seed = (base + pairNo * 104729 + rep * 7919) >>> 0;
        game++;
        const p0 = aFirst ? a : b;
        const p1 = aFirst ? b : a;
        const { engine, events } = runAiMatch({ deckA: p0, deckB: p1, seed, ai, maxCommands, aiLevel, victoryTarget: opts.victoryTarget, profiles: [profileOf(p0.id), profileOf(p1.id)] });
        const { stats, usage, inHand, cardDefs: cd } = collectMatchStats(engine, events);
        Object.assign(cardDefs, cd);
        for (const [k, n] of Object.entries(usage)) usageAgg[k] = (usageAgg[k] ?? 0) + n;
        for (const [k, n] of Object.entries(inHand)) inHandAgg[k] = (inHandAgg[k] ?? 0) + n;

        const aWon = aFirst ? stats.winner === 0 : stats.winner === 1;
        const bWon = !aWon && stats.winner !== -1;
        if (aWon) wins++; else if (bWon) losses++; else draws++;
        cellGames++;
        if (aFirst) { aP0++; if (aWon) aP0wins++; } else { aP1++; if (aWon) aP1wins++; }
        firstPlayer.games++;
        if (stats.winner === 0) firstPlayer.p0Wins++;
        else if (stats.winner === 1) firstPlayer.p1Wins++;
        else firstPlayer.draws++;
        if (isMirror) {
          firstPlayer.mirrorGames++;
          if (stats.winner === 0) firstPlayer.mirrorP0Wins++;
        }
        // vantagem de REGRA (quem abre) — `startingPlayer` é sorteado pelo
        // engine, independente do assento; é a leitura que separa "começar vale
        // mais" de "o RNG trata o assento 0 melhor".
        const starter = engine.state.startingPlayer;
        firstPlayer.starterGames++;
        if (stats.winner === starter) firstPlayer.starterWins++;
        if (isMirror) {
          firstPlayer.mirrorStarterGames++;
          if (stats.winner === starter) firstPlayer.mirrorStarterWins++;
        }

        // --- contagem global por deck: espelho conta como DUAS metas na mesma
        // partida (por isso tende a 50% por construção, não por sorte).
        if (isMirror) {
          acc[a.id].games += 2;
          acc[a.id].wins += 1; // um dos dois lados (mesmo deck) pontua
          seedGames[a.id][si] += 2;
          seedWins[a.id][si] += 1;
        } else {
          acc[a.id].games++; acc[b.id].games++;
          seedGames[a.id][si]++; seedGames[b.id][si]++;
          if (aWon) { acc[a.id].wins++; seedWins[a.id][si]++; }
          else if (bWon) { acc[b.id].wins++; seedWins[b.id][si]++; }
        }
        // --- split de assento: atribuído a quem OCUPAVA o assento
        acc[p0.id].p0Games++; acc[p1.id].p1Games++;
        if (stats.winner === 0) acc[p0.id].p0Wins++;
        else if (stats.winner === 1) acc[p1.id].p1Wins++;

        // --- estatísticas por meta
        for (const [d, idx] of [[a, aFirst ? 0 : 1], [b, aFirst ? 1 : 0]] as const) {
          const k = idx as 0 | 1;
          acc[d.id].turns += stats.turns;
          acc[d.id].turns2 += stats.turns * stats.turns;
          acc[d.id].damage += stats.damageDealt[k];
          acc[d.id].heal += stats.healed[k];
          acc[d.id].energy += stats.energiesAttached[k];
          acc[d.id].cards += stats.cardsPlayed[k];
          acc[d.id].kos += stats.kos[k];
          acc[d.id].koless += stats.longestKoless;
          if (stats.firstKoTurn > 0) { acc[d.id].firstKo += stats.firstKoTurn; acc[d.id].firstKoGames += 1; }
        }
        turnsSum += stats.turns;
        log(`[${String(game).padStart(5, '0')}/${totalGames}] ${a.id} vs ${b.id} → ${aWon ? a.id : bWon ? b.id : 'draw'} (${stats.turns} turnos)`);
      }
    }

    const cell: PairCell = {
      wins, losses, draws, games: cellGames,
      winsAsP0: aP0wins, gamesAsP0: aP0, winsAsP1: aP1wins, gamesAsP1: aP1,
      avgTurns: turnsSum / Math.max(1, cellGames)
    };
    matrix[a.id][b.id] = cell;
    if (!isMirror) {
      // mesma amostra, perspectiva invertida → soma exata de 100% por construção
      matrix[b.id][a.id] = {
        wins: losses, losses: wins, draws, games: cellGames,
        winsAsP0: aP0 - aP0wins, gamesAsP0: aP0,
        winsAsP1: aP1 - aP1wins, gamesAsP1: aP1,
        avgTurns: cell.avgTurns
      };
    }
    pairNo++;
  }

  const winRates: Record<string, number> = {};
  const avgTurns: Record<string, number> = {};
  const turnSd: Record<string, number> = {};
  const avgDamage: Record<string, number> = {};
  const avgHeal: Record<string, number> = {};
  const avgEnergies: Record<string, number> = {};
  const avgCardsPlayed: Record<string, number> = {};
  const avgKos: Record<string, number> = {};
  const avgKoless: Record<string, number> = {};
  const avgFirstKoTurn: Record<string, number> = {};
  const p0WinRate: Record<string, number> = {};
  const p1WinRate: Record<string, number> = {};
  const p0Games: Record<string, number> = {};
  const p1Games: Record<string, number> = {};
  const winRatesBySeed: Record<string, number[]> = {};
  const sd: Record<string, number> = {};
  const ci95: Record<string, [number, number]> = {};
  const mirror: Record<string, number> = {};

  for (const d of decks) {
    const a = acc[d.id];
    winRates[d.id] = a.games > 0 ? a.wins / a.games : 0;
    avgTurns[d.id] = a.games > 0 ? a.turns / a.games : 0;
    const meanT = avgTurns[d.id];
    turnSd[d.id] = a.games > 1 ? Math.sqrt(Math.max(0, a.turns2 / a.games - meanT * meanT)) : 0;
    avgDamage[d.id] = a.games > 0 ? a.damage / a.games : 0;
    avgHeal[d.id] = a.games > 0 ? a.heal / a.games : 0;
    avgEnergies[d.id] = a.games > 0 ? a.energy / a.games : 0;
    avgCardsPlayed[d.id] = a.games > 0 ? a.cards / a.games : 0;
    avgKos[d.id] = a.games > 0 ? a.kos / a.games : 0;
    avgKoless[d.id] = a.games > 0 ? a.koless / a.games : 0;
    avgFirstKoTurn[d.id] = a.firstKoGames > 0 ? a.firstKo / a.firstKoGames : 0;
    p0WinRate[d.id] = a.p0Games > 0 ? a.p0Wins / a.p0Games : 0;
    p1WinRate[d.id] = a.p1Games > 0 ? a.p1Wins / a.p1Games : 0;
    p0Games[d.id] = a.p0Games;
    p1Games[d.id] = a.p1Games;
    const per = seeds.map((_, i) => (seedGames[d.id][i] > 0 ? seedWins[d.id][i] / seedGames[d.id][i] : 0));
    winRatesBySeed[d.id] = per;
    sd[d.id] = stdDev(per);
    const half = per.length > 1 ? 1.96 * (sd[d.id] / Math.sqrt(per.length)) : 0;
    ci95[d.id] = [Math.max(0, winRates[d.id] - half), Math.min(1, winRates[d.id] + half)];
    const mm = matrix[d.id][d.id];
    if (mm) {
      const r0 = mm.gamesAsP0 > 0 ? mm.winsAsP0 / mm.gamesAsP0 : 0;
      const r1 = mm.gamesAsP1 > 0 ? mm.winsAsP1 / mm.gamesAsP1 : 0;
      mirror[d.id] = (r0 + r1) / 2;
    }
  }

  // matriz: verificar simetria e achar matchups brutais
  let matrixSkew = 0;
  const brutalMatchups: SimReport['brutalMatchups'] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      const A = decks[i].id, B = decks[j].id;
      const ca = matrix[A][B], cb = matrix[B][A];
      if (!ca || !cb) continue;
      const ra = ca.wins / Math.max(1, ca.games);
      const rb = cb.wins / Math.max(1, cb.games);
      matrixSkew = Math.max(matrixSkew, Math.abs(ra + rb - 1));
      if (ra >= 0.8 || ra <= 0.2) brutalMatchups.push({ a: A, b: B, rate: ra });
      if (rb >= 0.8 || rb <= 0.2) brutalMatchups.push({ a: B, b: A, rate: rb });
    }
  }
  brutalMatchups.sort((x, y) => y.rate - x.rate);

  const played = Object.entries(usageAgg).sort((x, y) => y[1] - x[1]).map(([id, plays]) => {
    const inHandN = inHandAgg[id] ?? 0;
    return { id, name: cardDefs[id] ?? registry.tryCard(id)?.name ?? id, plays, inHand: inHandN, playRate: inHandN > 0 ? Math.min(1, plays / inHandN) : plays > 0 ? 1 : 0 };
  });
  const deckPool = new Set<string>();
  for (const d of decks) for (const id of Object.keys(d.cards)) deckPool.add(id);
  const neverPlayed = registry.allCards()
    .filter((c) => deckPool.has(c.id) && !(c.id in usageAgg))
    .map((c) => ({ id: c.id, name: c.name, plays: 0, inHand: inHandAgg[c.id] ?? 0, playRate: 0 }));
  const deadInHand = played
    .filter((c) => c.inHand >= 20 && c.playRate < 0.25)
    .sort((x, y) => x.playRate - y.playRate)
    .slice(0, 25);

  const dominant = decks.filter((d) => winRates[d.id] > 0.65).map((d) => ({ deck: d.id, winRate: winRates[d.id] }));
  const weak = decks.filter((d) => winRates[d.id] < 0.35).map((d) => ({ deck: d.id, winRate: winRates[d.id] }));

  return {
    games: game,
    seeds,
    decks: decks.map((d) => ({ id: d.id, name: d.name })),
    matrix, winRates, winRatesBySeed, sd, ci95,
    avgTurns, turnSd, avgDamage, avgHeal, avgEnergies, avgCardsPlayed, avgKos,
    p0WinRate, p1WinRate, p0Games, p1Games,
    firstPlayer, avgKoless, avgFirstKoTurn,
    gamesPerPair,
    design: gamesPerPair % 2 === 0 ? 'paired-seats' : 'paired-seats-last-odd',
    mostPlayed: played.slice(0, 20),
    leastPlayed: played.slice(-20).reverse(),
    neverPlayed, deadInHand,
    dominant, weak, mirror, matrixSkew, brutalMatchups
  };
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Verificação matemática da matriz (Fase 22): A vs B + B vs A = 1. */
export function assertMatrixConsistent(report: SimReport, tol = 1e-9): void {
  const bad: string[] = [];
  for (const a of report.decks) {
    for (const b of report.decks) {
      if (a.id === b.id) continue;
      const ca = report.matrix[a.id][b.id];
      const cb = report.matrix[b.id][a.id];
      if (!ca || !cb) { bad.push(`${a.id}/${b.id}: célula ausente`); continue; }
      if (ca.games !== cb.games) bad.push(`${a.id}×${b.id}: jogos diferentes (${ca.games} vs ${cb.games})`);
      if (ca.wins + cb.wins !== ca.games) bad.push(`${a.id}×${b.id}: ${ca.wins}+${cb.wins} ≠ ${ca.games}`);
    }
  }
  if (bad.length) throw new Error(`matriz de matchup inconsistente:\n  ${bad.join('\n  ')}`);
}

/** Formata o relatório em markdown (usado no script CLI e nos docs). */
export function formatSimReport(report: SimReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`## Meta Simulation — ${report.games} partidas (${report.decks.length} decks, ${report.seeds.length} seed${report.seeds.length > 1 ? 's' : ''})`);
  lines.push('');
  lines.push('### Win rates');
  lines.push('| Deck | Win rate | ±95% IC | σ (seeds) | Turnos | 1º KO | P0 | P1 | Dano | Cura | KOs | Energias |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of report.decks) {
    const id = d.id;
    lines.push(`| ${d.name} | ${pct(report.winRates[id])} | ${pct(report.ci95[id][0])}–${pct(report.ci95[id][1])} | ${(report.sd[id] * 100).toFixed(1)}pp | ${report.avgTurns[id].toFixed(1)} | ${report.avgFirstKoTurn[id].toFixed(1)} | ${pct(report.p0WinRate[id])} | ${pct(report.p1WinRate[id])} | ${report.avgDamage[id].toFixed(0)} | ${report.avgHeal[id].toFixed(0)} | ${report.avgKos[id].toFixed(1)} | ${report.avgEnergies[id].toFixed(1)} |`);
  }
  const fp = report.firstPlayer;
  const gamesDesc = `cada par de partidas divide a mesma semente com assentos trocados (${report.gamesPerPair} partidas/par por seed)`;
  const p0Rate = fp.games ? fp.p0Wins / fp.games : 0;
  const mirrorRate = fp.mirrorGames ? fp.mirrorP0Wins / fp.mirrorGames : 0;
  // σ de uma proporção sobre n partidas independentes (para o leitor separar
  // "viés real de assento" de "ruído de amostra pequena").
  const sigma = (n: number) => (n > 0 ? Math.sqrt(0.25 / n) : 1);
  const starterRate = fp.starterGames ? fp.starterWins / fp.starterGames : 0;
  const mirrorStarterRate = fp.mirrorStarterGames ? fp.mirrorStarterWins / fp.mirrorStarterGames : 0;
  lines.push(`### Vantagem de quem abre (P0)
- todas as partidas: P0 ${pct(p0Rate)} · P1 ${pct(fp.games ? fp.p1Wins / fp.games : 0)} · empates ${fp.draws} · n=${fp.games} (σ amostral ${(sigma(fp.games) * 100).toFixed(1)}pp)
- **espelhos** (medida limpa do assento: mesmo baralho dos dois lados): P0 ${pct(mirrorRate)} · n=${fp.mirrorGames} (σ ${(sigma(fp.mirrorGames) * 100).toFixed(1)}pp)
- quem **começou** (sorteado pelo engine, independente do assento) vence ${pct(starterRate)} no field e ${pct(mirrorStarterRate)} nos espelhos (n=${fp.starterGames}) — vantagem de REGRA é isso; assento é o que denuncia viés de MEDIÇÃO
- por deck: ${report.decks.map((d) => `${d.name} ${pct(report.p0WinRate[d.id] ?? 0)}/${pct(report.p1WinRate[d.id] ?? 0)}`).join(' · ')}
- delineamento: \`${report.design}\` — ${gamesDesc}`);
  lines.push('');
  lines.push('### Matchup matrix (linha = perspectiva da coluna de cima; A×B + B×A = 100%)');
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
  lines.push(`Consistência da matriz: divergência máxima de 100% = ${(report.matrixSkew * 100).toFixed(3)}pp (deve ser 0).`);
  if (report.brutalMatchups.length) {
    lines.push('');
    lines.push('### ⚠️ Matchups sem counterplay (≥80% ou ≤20%)');
    for (const m of report.brutalMatchups) lines.push(`- ${name(report, m.a)} vs ${name(report, m.b)}: ${pct(m.rate)}`);
  }
  lines.push('');
  lines.push('### Cartas mais usadas');
  lines.push(report.mostPlayed.map((c) => `- ${c.name} (${c.id}): ${c.plays}× (jog/compr ${pct(c.playRate)})`).join('\n'));
  lines.push('');
  lines.push('### Cartas menos usadas');
  lines.push(report.leastPlayed.map((c) => `- ${c.name} (${c.id}): ${c.plays}× (jog/compr ${pct(c.playRate)})`).join('\n'));
  lines.push('');
  lines.push('### Cartas compradas e quase nunca jogadas (candidatas a corte/rework)');
  lines.push(report.deadInHand.length ? report.deadInHand.map((c) => `- ${c.name} (${c.id}): ${c.plays}× em ${c.inHand} compras (${pct(c.playRate)})`).join('\n') : '- nenhuma');
  lines.push('');
  lines.push('### Cartas nunca usadas');
  lines.push(report.neverPlayed.length ? report.neverPlayed.map((c) => `- ${c.name} (${c.id})`).join('\n') : '- nenhuma');
  if (report.dominant.length) {
    lines.push('');
    lines.push('### ⚠️ Dominância universal (>65% contra o field inteiro)');
    for (const d of report.dominant) lines.push(`- ${name(report, d.deck)}: ${pct(d.winRate)}`);
  }
  if (report.weak.length) {
    lines.push('');
    lines.push('### ⚠️ Abaixo do piso (<35% contra o field inteiro)');
    for (const d of report.weak) lines.push(`- ${name(report, d.deck)}: ${pct(d.winRate)}`);
  }
  lines.push('');
  lines.push('### Como ler isto');
  lines.push('- A matriz vem de UM conjunto de partidas por par, com os dois assentos alternados —');
  lines.push('  logo A×B + B×A soma exatamente 100% e o espelho mede a vantagem de saída.');
  lines.push('- O IC de 95% é calculado sobre replicações independentes (uma por seed); σ pequeno');
  lines.push('  significa que o número não é ruído de amostragem.');
  lines.push('- `jog/compr` baixo = carta comprada e largada na mão (morta); ausente de "nunca');
  lines.push('  usadas" mas com `plays` ínfimo = carta que o deck quase não compra.');
  return lines.join('\n');
}

function name(report: SimReport, id: string): string {
  return report.decks.find((d) => d.id === id)?.name ?? id;
}
