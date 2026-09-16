/**
 * Centralized, seeded randomness. All engine randomness flows through here so
 * matches are deterministic per seed (replays / sync / debugging later).
 */
/**
 * Avalanche (finalizador splitmix64 truncado em 32 bits).
 *
 * mulberry32 a partir de uma semente LITERAL tem os primeiros outputs
 * correlacionados a padrões da semente — e o sorteio de "quem abre" é o primeiro
 * consumo do stream. Com `seed = base + par·104729 + réplica·7919` (o padrão do
 * meta-sim) isso media 47,4% de "P0 começa" em n=2304 (σ≈1,0pp). Misturar antes
 * de usar tira o padrão sem alterar nada observável: mesma semente, mesma
 * sequência.
 */
export function mixSeed(seed: number, salt = 0): number {
  let z = ((seed >>> 0) + Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Estado inicial já aquecido (8 passos) — usado pelo `rngState` da partida. */
export function warmRng(seed: number, salt = 0): number {
  let state = mixSeed(seed, salt) || 0x9e3779b9;
  // os 8 passos são a própria evolução do estado no mulberry32 (o output é
  // função do estado; aquecer = avançar o estado sem ler)
  for (let i = 0; i < 8; i++) state = (state + 0x6d2b79f5) >>> 0;
  return state;
}

export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = mixSeed(seed) || 0x9e3779b9;
  }

  /** mulberry32 — returns float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}
