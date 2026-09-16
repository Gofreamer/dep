/**
 * RANKS — Liga Ranqueada JET.
 *
 * Hierarquia (fixa, da mais baixa para a mais alta):
 *   FERRO < BRONZE < PRATA < OURO < PLATINA < DIAMANTE < MESTRE < CAMPEÃO
 * e, acima de todos, REI DA LIGA — que NÃO é um rank "ganho por pontos":
 * só os 10 melhores CAMPEÕES do ranking global recebem o título.
 *
 * Regras de transição (dinâmicas, Fase 26):
 *  - subir: atingiu o piso do próximo rank E venceu a última partida;
 *  - cair: ficou abaixo do piso do rank atual E perdeu a última partida;
 *  - REI DA LIGA é computado a partir do Top 10 global (não é um piso).
 */

export interface RankDef {
  id: RankId;
  label: string;
  /** Piso de rating para entrar neste rank (FERRO = 0). */
  floor: number;
  order: number;
}

export const RANKS: RankDef[] = [
  { id: 'FERRO', label: 'Ferro', floor: 0, order: 0 },
  { id: 'BRONZE', label: 'Bronze', floor: 1100, order: 1 },
  { id: 'PRATA', label: 'Prata', floor: 1250, order: 2 },
  { id: 'OURO', label: 'Ouro', floor: 1400, order: 3 },
  { id: 'PLATINA', label: 'Platina', floor: 1550, order: 4 },
  { id: 'DIAMANTE', label: 'Diamante', floor: 1700, order: 5 },
  { id: 'MESTRE', label: 'Mestre', floor: 1850, order: 6 },
  { id: 'CAMPEAO', label: 'Campeão', floor: 2000, order: 7 }
] as const;

export type RankId = 'FERRO' | 'BRONZE' | 'PRATA' | 'OURO' | 'PLATINA' | 'DIAMANTE' | 'MESTRE' | 'CAMPEAO';

export const RANK_BY_ID: Record<RankId, RankDef> = Object.fromEntries(RANKS.map((r) => [r.id, r])) as Record<RankId, RankDef>;

/**
 * Ordem canônica (baixa → alta). Fonte ÚNICA para UI/ladder — a tela de Ranked
 * mantinha uma cópia local da lista (fonte de divergência na 2.0).
 */
export const RANK_ORDER: RankId[] = RANKS.map((r) => r.id);

/** Compara ranks pela ordem da liga (maior = mais forte). */
export function rankOrderOf(id: RankId): number {
  return RANK_BY_ID[id]?.order ?? -1;
}

/** Rank padrão para um rating — ignora transições dinâmicas (usa só o piso). */
export function rankFor(rating: number): RankDef {
  let best = RANKS[0];
  for (const r of RANKS) if (rating >= r.floor) best = r;
  return best;
}

/** Próximo rank acima (null se já é CAMPEÃO). */
export function nextRank(rating: number): RankDef | null {
  const cur = rankFor(rating);
  const next = RANKS.find((r) => r.order === cur.order + 1);
  return next ?? null;
}

export interface RankTransition {
  from: RankId;
  to: RankId | null;
  direction: 'up' | 'down' | 'none';
}

/**
 * Transição dinâmica de rank (Fase 26).
 *  - sobe se `rating` alcança o piso do próximo rank E `wonLast` (ganhou a última);
 *  - cai se `rating` caiu abaixo do piso do rank atual E `!wonLast` (perdeu a última);
 *  - nunca cai de FERRO; nunca sobe acima de CAMPEÃO (REI DA LIGA é título).
 */
export function transition(rating: number, wonLast: boolean, current: RankId): RankTransition {
  const cur = RANK_BY_ID[current];
  const above = RANKS.find((r) => r.order === cur.order + 1);
  if (above && rating >= above.floor && wonLast) {
    return { from: current, to: above.id, direction: 'up' };
  }
  if (cur.order > 0 && rating < cur.floor && !wonLast) {
    const below = RANKS[cur.order - 1];
    return { from: current, to: below.id, direction: 'down' };
  }
  return { from: current, to: current, direction: 'none' };
}
