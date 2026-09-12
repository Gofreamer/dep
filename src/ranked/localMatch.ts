/**
 * PARTIDA LOCAL (lado do cliente) — o humano joga contra o bot no próprio
 * navegador e o cliente REGISTRA apenas os comandos do humano.
 *
 * O resultado não é decidido aqui: no fim, a sequência de comandos é enviada
 * ao servidor, que REPETE a partida (replay) e determina o vencedor.
 */

import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import type { AiProfile } from '../engine/ai/profile';
import type { CardDef, Command, PlayerId } from '../engine/types';

export interface LocalMatchResult {
  winner: PlayerId;
  endReason: string;
  turns: number;
  /** Comandos do humano (para envio ao servidor). */
  humanCommands: Command[];
}

/**
 * Roda a partida humana-vs-bot localmente. `humanMove` gera o próximo comando
 * do humano (ex.: a partir da UI). Retorna o resultado local (apenas para a
 * UI) e a lista de comandos do humano para submissão server-side.
 */
export function runLocalRankedMatch(args: {
  seed: number;
  humanDeck: CardDef[];
  botDeck: CardDef[];
  botProfile: AiProfile;
  humanSeat: PlayerId;
  humanMove: (engine: MatchEngine) => Command;
  maxCommands?: number;
}): LocalMatchResult {
  const humanSeat = args.humanSeat;
  const botSeat = (humanSeat === 0 ? 1 : 0) as PlayerId;
  const maxCommands = args.maxCommands ?? 4000;
  const humanCommands: Command[] = [];

  const engine = new MatchEngine({
    seed: args.seed,
    players: [
      { name: humanSeat === 0 ? 'human' : 'bot', deckId: humanSeat === 0 ? 'human' : 'bot', isAI: humanSeat !== 0, aiLevel: humanSeat === 0 ? 'normal' : 'hard', deck: humanSeat === 0 ? args.humanDeck : args.botDeck },
      { name: humanSeat === 1 ? 'human' : 'bot', deckId: humanSeat === 1 ? 'human' : 'bot', isAI: humanSeat !== 1, aiLevel: humanSeat === 1 ? 'normal' : 'hard', deck: humanSeat === 1 ? args.humanDeck : args.botDeck }
    ]
  });

  const resolvePending = (): void => {
    for (;;) {
      const pend = engine.getPending();
      if (!pend) break;
      if (pend.player === humanSeat) {
        const selected = aiSmartChoice(engine.state, humanSeat, pend);
        humanCommands.push({ type: 'RESOLVE_CHOICE', player: humanSeat, selected });
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: humanSeat, selected });
      } else {
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
      }
    }
  };

  // setup (sequencial: jogador 0 depois o 1)
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && guard++ < 100) {
      if (p === humanSeat) {
        const cmd = args.humanMove(engine);
        humanCommands.push(cmd);
        engine.dispatch(cmd);
      } else {
        engine.dispatch(aiNextCommand(engine, botSeat, args.botProfile));
      }
      resolvePending();
    }
  }

  let guard = 0;
  while (engine.state.phase !== 'gameOver' && guard++ < maxCommands) {
    const actor = engine.state.activePlayer as PlayerId;
    if (actor === humanSeat) {
      const cmd = args.humanMove(engine);
      humanCommands.push(cmd);
      engine.dispatch(cmd);
    } else {
      engine.dispatch(aiNextCommand(engine, botSeat, args.botProfile));
    }
    resolvePending();
  }

  const winner = engine.state.winner;
  if (winner !== 0 && winner !== 1) throw new Error('partida local sem vencedor');
  return { winner, endReason: engine.state.endReason ?? '', turns: engine.state.turn, humanCommands };
}
