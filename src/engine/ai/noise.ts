/**
 * Fonte de aleatoriedade da IA — **função pura do estado público**.
 *
 * ## Por que isso existe
 * A IA do 2.0 usava `rand(state)` (o mesmo fluxo que alimenta moedas de
 * `coinFlip`, embaralhamentos e o sorteio de `startingPlayer`) para adicionar
 * ruído às pontuações. Consequências reais disso:
 *
 * 1. **A IA perturbava o jogo.** Quantas vezes o ruído era sorteado dependia de
 *    quantas opções o avaliador enumerou (que depende da mão!) — logo o
 *    comportamento interno da IA deslocava o sorteio de quem abre a partida e
 *    qualquer `coinFlip` futuro. Dois perfis de IA diferentes jogando o mesmo
 *    estado mudavam não só as jogadas, mas as moedas do oponente.
 * 2. **Medições de meta ficavam sujas.** "Quem abriu em P0" passou a
 *    correlacionar com a paridade do consumo de RNG do setup, o que aparecia
 *    como viés de assento de 6+ pp nos espelhos do simulador.
 *
 * ## Propriedades
 * - Determinística: `(seed, turn, commandCount, jogador, k)`-ésimo valor é
 *   sempre o mesmo → replays e testes continuam reprodutíveis.
 * - **Não consome `state.rngState`**: a IA não pode influenciar moedas,
 *   embaralhamentos nem `startingPlayer`. Isso é também uma propriedade de
 *   anti-trapaça: o avaliador não tem canal nenhum sobre o RNG da partida.
 * - Usa só informação pública (nada de mão/adversário aqui).
 */

/** finalizador murmur3 (fmix32) — avalanche barata e bem estudada */
function fmix32(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return x >>> 0;
}

function mix(a: number, b: number): number {
  return fmix32((fmix32(a) ^ Math.imul(b | 0, 2654435761)) >>> 0);
}

function unit(x: number): number {
  return x / 4294967296;
}

export interface AiNoise {
  /** uniforme [0,1) */
  next(): number;
  /** desvio simétrico em [-scale, +scale] */
  jitter(scale: number): number;
  /** índice inteiro em [0, n) */
  index(n: number): number;
}

export interface NoiseKey {
  seed: number;
  turn: number;
  /** contador monotônico de eventos (avança a cada despacho) */
  commandCount: number;
  player: number;
}

/**
 * Cria a sequência de ruído de UMA decisão. Reconstruir a chave a partir do
 * estado garante que a mesma posição de jogo gera as mesmas escolhas, e que o
 * consumo de ruído nunca toca no RNG da partida.
 */
export function createAiNoise(key: NoiseKey): AiNoise {
  const base = mix(mix(key.seed >>> 0, (key.turn + 1) * 2654435761), mix(key.player + 1, (key.commandCount + 1) * 40503));
  let k = 0;
  const draw = () => unit(mix(base, ++k * 7919));
  return {
    next: draw,
    jitter: (scale: number) => (draw() - 0.5) * 2 * scale,
    index: (n: number) => (n <= 1 ? 0 : Math.min(n - 1, Math.floor(draw() * n)))
  };
}
