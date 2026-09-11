/**
 * JET TCG — resolver central de arte (ÚNICA fonte de verdade da UI).
 *
 * Fluxo oficial (compatível com futuro multiplayer que transmite só
 * `cardId`/`command`/`state` — NENHUMA imagem trafega no protocolo):
 *
 *   cardId → CardDef → resolveCardArt() → URL pública → <img>
 *
 * Ordem de resolução (ver `src/integrations/jet/cardArt.ts`):
 *   1) arte específica da edição (`specialImageUrl` da fonte);
 *   2) arte BASE da mesma `identityId` (fallback SOMENTE visual — a edição
 *      mecânica da carta não muda);
 *   3) fallback procedural (`{ kind: 'procedural' }` — a UI renderiza o
 *      `Artwork` procedural atual).
 *
 * Nenhuma URL é gravada em `CardDef`, `MatchState`, saves ou `localStorage`:
 * a arte é resolvida em runtime a partir do snapshot versionado
 * (`artSnapshot.ts`) + cache HTTP normal do navegador.
 */
import type { CardDef } from '../../engine/types';
import {
  createArtIndex,
  resolveArtWithIndex,
  type JetArtProvenance,
  type ResolvedCardArt
} from '../../integrations/jet/cardArt';
import { JET_ART_SNAPSHOT } from './artSnapshot';

export type { ResolvedCardArt };

const ART_INDEX = createArtIndex(JET_ART_SNAPSHOT.entries);

/** Entrada mínima para resolução (qualquer `CardDef` serve). */
export type ArtResolvable = Pick<CardDef, 'identityId' | 'edition'>;

/**
 * Resolve a arte de uma carta. Puro e determinístico: mesma entrada, mesma
 * saída; nunca faz rede, nunca lança exceção, nunca muta a entrada.
 */
export function resolveCardArt(def: ArtResolvable | null | undefined): ResolvedCardArt {
  if (!def) return { kind: 'procedural' };
  return resolveArtWithIndex(ART_INDEX, def.identityId, def.edition);
}

/** `true` quando há arte remota (específica ou BASE) para a carta. */
export function hasRemoteArt(def: ArtResolvable | null | undefined): boolean {
  return resolveCardArt(def).kind === 'remote';
}

/** URL remota da carta ou `null` (fallback procedural). */
export function remoteArtUrl(def: ArtResolvable | null | undefined): string | null {
  const resolved = resolveCardArt(def);
  return resolved.kind === 'remote' ? resolved.url : null;
}

/**
 * Pré-carrega (best-effort, sem bloquear) as artes de uma lista de cartas —
 * usar SOMENTE para o que provavelmente aparecerá (decks da partida, ativo,
 * reserva, mão). Nunca pré-carrega o catálogo inteiro.
 */
export function preloadCardArt(defs: Iterable<ArtResolvable>): void {
  try {
    if (typeof Image === 'undefined') return;
    const seen = new Set<string>();
    for (const def of defs) {
      const resolved = resolveCardArt(def);
      if (resolved.kind !== 'remote' || seen.has(resolved.url)) continue;
      seen.add(resolved.url);
      const img = new Image();
      img.decoding = 'async';
      img.src = resolved.url;
    }
  } catch {
    // Preload nunca pode quebrar a partida.
  }
}

/** Proveniência do snapshot de arte em uso (repositório + commit fonte). */
export function artSnapshotProvenance(): JetArtProvenance {
  return JET_ART_SNAPSHOT.provenance;
}

/** Quantidade de entradas de arte no snapshot (diagnóstico/testes). */
export function artSnapshotSize(): number {
  return JET_ART_SNAPSHOT.entries.length;
}
