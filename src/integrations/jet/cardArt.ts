/**
 * JET TCG — artes oficiais via Jet Cards (`Gofreamer/cartinhas23`).
 *
 * Este módulo é a ÚNICA fonte de verdade sobre arte de carta no TCG.
 * Ele NÃO fala com Firebase, Fórum ou rede: opera sobre um snapshot pequeno,
 * limpo e versionado (`src/data/jet/artSnapshot.ts`) gerado offline por
 * `scripts/import-jet-card-art.ts` a partir de `seed-cards-import.json`.
 *
 * Lógica preservada do Jet Cards (`js/utils/photos.js` +
 * `js/features/cards/cards-ui-card.js`):
 *
 *   specialImageUrl da edição especial
 *     ↓ (não existe)
 *   foto BASE do agente/jogador (`photo` → `photoUrl` → `image`)
 *     ↓ (não existe)
 *   fallback visual do JET TCG (arte procedural — camada de UI)
 *
 * Regras desta integração:
 *  - URLs são tratadas como "URL de arte" independente do provedor
 *    (GitHub, GitHub Pages, Imgur ou outra origem pública HTTPS válida).
 *  - Somente protocolo seguro (`https:` em produção; `http:` apenas com
 *    opt-in explícito de desenvolvimento). `javascript:`, `data:`, `file:`
 *    e afins são sempre rejeitados.
 *  - Matching é por nome normalizado (case/espaços/acentos/URL encoding)
 *    contra as identidades canônicas do TCG — equipe NUNCA é chave de
 *    matching (divergência de equipe gera warning, nunca um segundo agente).
 *  - Ambiguidade real (dois agentes canônicos com o mesmo nome normalizado)
 *    é rejeitada: nenhum chute, registro vai para `ambiguous`/`unresolved`.
 *  - `CardDef` de gameplay NÃO carrega URLs: o fluxo é sempre
 *    `cardId → CardDef → resolveCardArt() → URL` (compatível com futuro
 *    multiplayer que transmite só `cardId`/`command`/`state`).
 */

export type JetArtSourceType = 'base' | 'special';

export type JetArtOrigin = 'github' | 'github-pages' | 'imgur' | 'other';

export interface JetArtProvenance {
  sourceRepository: 'Gofreamer/cartinhas23';
  /** SHA cheio do commit da fonte usado na importação. */
  sourceCommit: string;
  /** Data ISO (AAAA-MM-DD) da geração do snapshot. */
  capturedAt: string;
  sourceFile: 'seed-cards-import.json';
}

export interface JetArtEntry {
  /** Identidade canônica do TCG (ex.: `agent-jenny`). */
  identityId: string;
  /** Nome canônico de exibição (diagnóstico — NUNCA chave de lookup). */
  name: string;
  /** Edição canônica do TCG (`BASE`, `MVP`, `CHAMPION`, `FINALS`, `ICON`…). */
  edition: string;
  /** URL pública da arte, exatamente como publicada na fonte. */
  url: string;
  source: 'jet-cards';
  sourceType: JetArtSourceType;
  provenance: {
    repository: 'Gofreamer/cartinhas23';
    sourceCommit: string;
    /** Chave `Equipe_Nome` do jogador na fonte (entradas `base`). */
    playerKey?: string;
    /** `defId` da carta especial na fonte (entradas `special`). */
    defId?: string;
  };
}

export interface JetArtSnapshot {
  version: 1;
  provenance: JetArtProvenance;
  /** Ordenado por (`identityId`, `edition`) para diffs estáveis. */
  entries: JetArtEntry[];
}

/** Formato tolerante dos registros de jogador em `seed-cards-import.json`. */
export interface JetCardsPlayerSeed {
  name?: unknown;
  team?: unknown;
  rank?: unknown;
  photo?: unknown;
  photoUrl?: unknown;
  image?: unknown;
  [key: string]: unknown;
}

/** Formato tolerante das cartas especiais em `seed-cards-import.json`. */
export interface JetCardsSpecialSeed {
  playerName?: unknown;
  playerKey?: unknown;
  edition?: unknown;
  specialImageUrl?: unknown;
  team?: unknown;
  defId?: unknown;
  [key: string]: unknown;
}

/** Identidade canônica mínima do TCG para matching. */
export interface TcgAgentRef {
  agentId: string;
  name: string;
  team?: string;
}

// ---------------------------------------------------------------------------
// Normalização de nomes (SOMENTE para comparação — o nome canônico exibido
// nunca é alterado por esta função).
// ---------------------------------------------------------------------------

/**
 * Normaliza para COMPARAÇÃO: decodifica URL encoding, remove acentos,
 * dobra case/espaços/pontuação. Ex.: `Tayná  Lannister Müller` ≡
 * `tayna lannister muller` ≡ `Tayn%C3%A1%20Lannister%20M%C3%BCller`.
 */
export function normalizeAgentName(name: string): string {
  let s = name;
  try {
    // Nomes vindos de chaves/URLs podem estar percent-encoded.
    s = decodeURIComponent(s);
  } catch {
    /* mantém o original quando o encoding é inválido */
  }
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Edições: mapeamento explícito e documentado fonte → TCG.
// A fonte (`seed-cards-import.json`, campo `edition`) hoje usa os mesmos
// rótulos canônicos do TCG; os aliases abaixo cobrem variantes históricas
// (ex.: `CHAMPIONS`/`FINAL` aparecem em nomes de arquivo legados).
// Edições futuras desconhecidas são ACEITAS (normalizadas em MAIÚSCULAS)
// com warning `unknown-edition` — nunca silenciosamente descartadas.
// ---------------------------------------------------------------------------

export const ART_EDITION_ALIASES: Record<string, string> = {
  BASE: 'BASE',
  MVP: 'MVP',
  CHAMPION: 'CHAMPION',
  CHAMPIONS: 'CHAMPION',
  FINAL: 'FINALS',
  FINALS: 'FINALS',
  ICON: 'ICON',
  ICONE: 'ICON'
};

export function isKnownArtEdition(canonical: string): boolean {
  return Object.values(ART_EDITION_ALIASES).includes(canonical);
}

/**
 * Normaliza o rótulo de edição da fonte para o canônico do TCG.
 * Retorna `null` apenas quando não há rótulo aproveitável (ausente/não-texto).
 */
export function canonicalizeArtEdition(edition: unknown): string | null {
  if (typeof edition !== 'string' || !edition.trim()) return null;
  const key = edition
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
  return ART_EDITION_ALIASES[key] ?? key;
}

// ---------------------------------------------------------------------------
// URLs: validação e classificação por origem.
// ---------------------------------------------------------------------------

export interface ArtUrlPolicy {
  /**
   * Permite `http:` (NUNCA em produção — apenas desenvolvimento local quando
   * realmente necessário). `https:` é sempre permitido; qualquer outro
   * esquema é sempre rejeitado.
   */
  allowHttp?: boolean;
}

/**
 * Verifica se a URL pode ser usada como arte. Qualquer origem pública
 * HTTPS válida é aceita — a lógica principal trata tudo como "URL de arte",
 * sem ramificar por provedor.
 */
export function isArtUrlAllowed(url: unknown, policy: ArtUrlPolicy = {}): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:' && policy.allowHttp) return true;
  return false;
}

/**
 * Normalização de URL: apenas `trim`. Decisão documentada — URLs
 * `github.com/.../blob/...?raw=true` da fonte já funcionam no navegador
 * (redirecionam para o conteúdo raw), então NÃO são reescritas; reescrever
 * sem necessidade arriscaria quebrar arte que hoje funciona.
 */
export function normalizeArtUrl(url: string): string {
  return url.trim();
}

/** Classifica a origem para auditoria (NÃO afeta a resolução). */
export function artUrlOrigin(url: string): JetArtOrigin {
  let host = '';
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host === 'i.imgur.com' || host.endsWith('.imgur.com') || host === 'imgur.com') return 'imgur';
  if (host.endsWith('.github.io') || host === 'github.io') return 'github-pages';
  if (host === 'github.com' || host === 'www.github.com' || host === 'raw.githubusercontent.com') return 'github';
  return 'other';
}

/**
 * Valor bruto da foto BASE no registro do jogador — mesma semântica do Jet
 * Cards (`js/utils/photos.js`): `player.photo || player.photoUrl ||
 * player.image || ""`.
 *
 * Ou seja: o PRIMEIRO valor string NÃO VAZIO (após `trim`) entre os três
 * campos. Um `photo` vazio (ou só espaços) NÃO bloqueia `photoUrl`/`image` —
 * comportamento de `||`, não de `??`.
 *
 * Usado pelo importador para distinguir "sem imagem" (vazio) de "URL inválida".
 */
export function rawBasePhotoOf(player: JetCardsPlayerSeed | null | undefined): string {
  if (!player) return '';
  for (const candidate of [player.photo, player.photoUrl, player.image]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Melhor foto BASE disponível no registro do jogador.
 * Diferente da fonte, NÃO gera avatar DiceBear: retorna `''` quando não há
 * URL HTTP(S) válida (o TCG usa seu próprio fallback procedural).
 */
export function basePhotoOf(player: JetCardsPlayerSeed | null | undefined): string {
  const trimmed = rawBasePhotoOf(player);
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

// ---------------------------------------------------------------------------
// Snapshot builder (puro e determinístico — sem FS, sem rede, sem data atual).
// ---------------------------------------------------------------------------

export type JetArtWarningCode =
  | 'legacy-team'
  | 'duplicate-base'
  | 'duplicate-special'
  | 'unknown-edition';

export interface JetArtImportWarning {
  code: JetArtWarningCode;
  message: string;
  identityId?: string;
  edition?: string;
}

export interface JetArtImportReport {
  /** Registros lidos da fonte. */
  sourceRecords: { players: number; specials: number };
  /** Agentes BASE do TCG com foto reconhecida. */
  baseRecognized: number;
  /** Cartas especiais do TCG com `specialImageUrl` reconhecida. */
  specialsRecognized: number;
  /** URLs distintas no snapshot gerado. */
  distinctUrls: number;
  /** Origens das URLs do snapshot. */
  origins: Record<JetArtOrigin, number>;
  /** Origens de TODAS as URLs válidas da fonte (inclui não-TCG). */
  sourceOrigins: Record<JetArtOrigin, number>;
  /** URLs distintas válidas na fonte inteira (inclui não-TCG). */
  sourceDistinctUrls: number;
  /** URLs presentes mas com protocolo/esquema rejeitado. */
  invalidUrls: { where: string; url: string }[];
  /** Chaves da fonte sem nenhuma imagem (`photo`/`specialImageUrl` vazio). */
  recordsWithoutImage: string[];
  /** `playerKey`s da fonte que não casam com identidade TCG (quase todos são
   *  membros do elenco fora do TCG — esperado, não é erro). */
  unmatchedPlayers: string[];
  /** `defId`s especiais que não casaram (nome/edição). */
  unmatchedSpecials: string[];
  /** Nomes que casariam com 2+ identidades canônicas — rejeitados. */
  ambiguous: { normalized: string; candidates: string[] }[];
  /** `identityId`s do TCG atual sem foto BASE. */
  tcgAgentsWithoutBaseArt: string[];
  /** Especiais jogáveis do TCG atual sem `specialImageUrl`. */
  tcgEditionsWithoutSpecialArt: { identityId: string; name: string; edition: string }[];
  warnings: JetArtImportWarning[];
}

export interface BuildArtSnapshotInput {
  players: Record<string, JetCardsPlayerSeed>;
  specials: Record<string, JetCardsSpecialSeed>;
  tcgAgents: TcgAgentRef[];
  /**
   * Especiais jogáveis atuais (`identityId` + `edition`) para auditoria.
   * O importador deriva de `JET_SNAPSHOT.editionVariants`.
   */
  playableSpecials?: { identityId: string; edition: string }[];
  sourceCommit: string;
  capturedAt: string;
  allowHttp?: boolean;
}

const EDITION_SORT_ORDER: Record<string, number> = { BASE: 0, MVP: 1, CHAMPION: 2, FINALS: 3, ICON: 4 };

function sortEntries(entries: JetArtEntry[]): JetArtEntry[] {
  return [...entries].sort((a, b) => {
    if (a.identityId !== b.identityId) return a.identityId < b.identityId ? -1 : 1;
    const oa = EDITION_SORT_ORDER[a.edition] ?? 99;
    const ob = EDITION_SORT_ORDER[b.edition] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.edition < b.edition ? -1 : a.edition > b.edition ? 1 : 0;
  });
}

function emptyOrigins(): Record<JetArtOrigin, number> {
  return { github: 0, 'github-pages': 0, imgur: 0, other: 0 };
}

function teamKey(team: string | undefined): string {
  return normalizeAgentName(team ?? '');
}

type NameMatch =
  | { status: 'matched'; agent: TcgAgentRef }
  | { status: 'unmatched' }
  | { status: 'ambiguous'; candidates: TcgAgentRef[] };

function matchByName(index: Map<string, TcgAgentRef[]>, name: string): NameMatch {
  const list = index.get(normalizeAgentName(name)) ?? [];
  if (list.length === 1) return { status: 'matched', agent: list[0] };
  if (list.length === 0) return { status: 'unmatched' };
  return { status: 'ambiguous', candidates: list };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function buildArtSnapshot(input: BuildArtSnapshotInput): { snapshot: JetArtSnapshot; report: JetArtImportReport } {
  const policy: ArtUrlPolicy = { allowHttp: input.allowHttp };
  const byName = new Map<string, TcgAgentRef[]>();
  for (const agent of input.tcgAgents) {
    const key = normalizeAgentName(agent.name);
    const list = byName.get(key) ?? [];
    list.push(agent);
    byName.set(key, list);
  }
  const agentById = new Map(input.tcgAgents.map((a) => [a.agentId, a]));

  const entries: JetArtEntry[] = [];
  const baseSeen = new Set<string>();
  const specialSeen = new Set<string>();
  const report: JetArtImportReport = {
    sourceRecords: { players: 0, specials: 0 },
    baseRecognized: 0,
    specialsRecognized: 0,
    distinctUrls: 0,
    origins: emptyOrigins(),
    sourceOrigins: emptyOrigins(),
    sourceDistinctUrls: 0,
    invalidUrls: [],
    recordsWithoutImage: [],
    unmatchedPlayers: [],
    unmatchedSpecials: [],
    ambiguous: [],
    tcgAgentsWithoutBaseArt: [],
    tcgEditionsWithoutSpecialArt: [],
    warnings: []
  };
  const ambiguousSeen = new Set<string>();
  const sourceValidUrls = new Set<string>();
  const noteAmbiguous = (normalized: string, candidates: TcgAgentRef[]): void => {
    if (ambiguousSeen.has(normalized)) return;
    ambiguousSeen.add(normalized);
    report.ambiguous.push({ normalized, candidates: candidates.map((c) => c.agentId).sort() });
  };
  const noteSourceUrl = (url: string): void => {
    sourceValidUrls.add(url);
    report.sourceOrigins[artUrlOrigin(url)] += 1;
  };

  // ---- jogadores → fotos BASE -------------------------------------------
  const playerKeys = Object.keys(input.players).sort();
  report.sourceRecords.players = playerKeys.length;
  for (const playerKey of playerKeys) {
    const seed = input.players[playerKey] ?? {};
    const name = str(seed.name);
    // Valor bruto para auditoria: vazio → sem imagem; rejeitado → inválida.
    const photoRaw = rawBasePhotoOf(seed);
    if (!name) {
      report.unmatchedPlayers.push(`${playerKey} (sem nome)`);
      if (!photoRaw) report.recordsWithoutImage.push(playerKey);
      else if (!isArtUrlAllowed(photoRaw, policy)) report.invalidUrls.push({ where: playerKey, url: photoRaw });
      else noteSourceUrl(normalizeArtUrl(photoRaw));
      continue;
    }
    const match = matchByName(byName, name);
    const normalized = normalizeAgentName(name);
    if (match.status === 'ambiguous') {
      noteAmbiguous(normalized, match.candidates);
      if (!photoRaw) report.recordsWithoutImage.push(playerKey);
      else if (!isArtUrlAllowed(photoRaw, policy)) report.invalidUrls.push({ where: playerKey, url: photoRaw });
      else noteSourceUrl(normalizeArtUrl(photoRaw));
      continue;
    }
    if (match.status === 'unmatched') {
      report.unmatchedPlayers.push(playerKey);
      if (!photoRaw) report.recordsWithoutImage.push(playerKey);
      else if (!isArtUrlAllowed(photoRaw, policy)) report.invalidUrls.push({ where: playerKey, url: photoRaw });
      else noteSourceUrl(normalizeArtUrl(photoRaw));
      continue;
    }
    // Casou com identidade canônica — equipe NÃO é chave (só warning).
    const agent = match.agent;
    const playerTeam = str(seed.team);
    if (playerTeam && teamKey(playerTeam) !== teamKey(agent.team)) {
      report.warnings.push({
        code: 'legacy-team',
        message: `foto BASE de ${agent.name} (${agent.agentId}) veio de equipe divergente na fonte: '${playerTeam}' ≠ '${agent.team ?? '?'}' — associada pela identidade, sem criar segundo agente.`,
        identityId: agent.agentId,
        edition: 'BASE'
      });
    }
    if (!photoRaw) {
      report.recordsWithoutImage.push(playerKey);
      continue;
    }
    if (!isArtUrlAllowed(photoRaw, policy)) {
      report.invalidUrls.push({ where: playerKey, url: photoRaw });
      continue;
    }
    const url = normalizeArtUrl(photoRaw);
    noteSourceUrl(url);
    if (baseSeen.has(agent.agentId)) {
      report.warnings.push({
        code: 'duplicate-base',
        message: `foto BASE duplicada para ${agent.agentId} em '${playerKey}' — mantida a primeira.`,
        identityId: agent.agentId,
        edition: 'BASE'
      });
      continue;
    }
    baseSeen.add(agent.agentId);
    entries.push({
      identityId: agent.agentId,
      name: agent.name,
      edition: 'BASE',
      url,
      source: 'jet-cards',
      sourceType: 'base',
      provenance: { repository: 'Gofreamer/cartinhas23', sourceCommit: input.sourceCommit, playerKey }
    });
  }

  // ---- especiais → specialImageUrl (prioridade sobre a BASE) -------------
  const defIds = Object.keys(input.specials).sort();
  report.sourceRecords.specials = defIds.length;
  for (const defId of defIds) {
    const seed = input.specials[defId] ?? {};
    const playerName = str(seed.playerName);
    const edition = canonicalizeArtEdition(seed.edition);
    const rawUrl = str(seed.specialImageUrl);
    if (!playerName || !edition) {
      report.unmatchedSpecials.push(defId);
      if (!rawUrl) report.recordsWithoutImage.push(defId);
      else if (!isArtUrlAllowed(rawUrl, policy)) report.invalidUrls.push({ where: defId, url: rawUrl });
      else noteSourceUrl(normalizeArtUrl(rawUrl));
      continue;
    }
    if (!isKnownArtEdition(edition)) {
      report.warnings.push({
        code: 'unknown-edition',
        message: `edição '${edition}' de '${defId}' não consta no mapeamento conhecido — importada mesmo assim (normalizada em MAIÚSCULAS).`,
        edition
      });
    }
    const match = matchByName(byName, playerName);
    const normalized = normalizeAgentName(playerName);
    if (match.status === 'ambiguous') {
      noteAmbiguous(normalized, match.candidates);
      report.unmatchedSpecials.push(defId);
      if (!rawUrl) report.recordsWithoutImage.push(defId);
      else if (!isArtUrlAllowed(rawUrl, policy)) report.invalidUrls.push({ where: defId, url: rawUrl });
      else noteSourceUrl(normalizeArtUrl(rawUrl));
      continue;
    }
    if (match.status === 'unmatched') {
      report.unmatchedSpecials.push(defId);
      if (!rawUrl) report.recordsWithoutImage.push(defId);
      else if (!isArtUrlAllowed(rawUrl, policy)) report.invalidUrls.push({ where: defId, url: rawUrl });
      else noteSourceUrl(normalizeArtUrl(rawUrl));
      continue;
    }
    const agent = match.agent;
    const specialTeam = str(seed.team);
    if (specialTeam && teamKey(specialTeam) !== teamKey(agent.team)) {
      report.warnings.push({
        code: 'legacy-team',
        message: `especial ${agent.name} ${edition} ('${defId}') aponta para equipe legada '${specialTeam}' ≠ '${agent.team ?? '?'}' — associada pela identidade, sem criar segundo agente.`,
        identityId: agent.agentId,
        edition
      });
    }
    if (!rawUrl) {
      report.recordsWithoutImage.push(defId);
      continue;
    }
    if (!isArtUrlAllowed(rawUrl, policy)) {
      report.invalidUrls.push({ where: defId, url: rawUrl });
      continue;
    }
    const url = normalizeArtUrl(rawUrl);
    noteSourceUrl(url);
    const key = `${agent.agentId}#${edition}`;
    if (specialSeen.has(key)) {
      report.warnings.push({
        code: 'duplicate-special',
        message: `arte especial duplicada para ${key} em '${defId}' — mantida a primeira.`,
        identityId: agent.agentId,
        edition
      });
      continue;
    }
    specialSeen.add(key);
    entries.push({
      identityId: agent.agentId,
      name: agent.name,
      edition,
      url,
      source: 'jet-cards',
      sourceType: 'special',
      provenance: {
        repository: 'Gofreamer/cartinhas23',
        sourceCommit: input.sourceCommit,
        playerKey: str(seed.playerKey) || undefined,
        defId
      }
    });
  }

  const sorted = sortEntries(entries);
  const distinct = new Set(sorted.map((e) => e.url));
  report.distinctUrls = distinct.size;
  for (const entry of sorted) {
    report.origins[artUrlOrigin(entry.url)] += 1;
  }
  report.sourceDistinctUrls = sourceValidUrls.size;
  report.baseRecognized = baseSeen.size;
  report.specialsRecognized = specialSeen.size;

  for (const agent of input.tcgAgents) {
    if (!baseSeen.has(agent.agentId)) report.tcgAgentsWithoutBaseArt.push(agent.agentId);
  }
  report.tcgAgentsWithoutBaseArt.sort();
  for (const spec of input.playableSpecials ?? []) {
    if (!specialSeen.has(`${spec.identityId}#${spec.edition}`)) {
      report.tcgEditionsWithoutSpecialArt.push({
        identityId: spec.identityId,
        name: agentById.get(spec.identityId)?.name ?? spec.identityId,
        edition: spec.edition
      });
    }
  }
  report.tcgEditionsWithoutSpecialArt.sort((a, b) =>
    a.identityId < b.identityId ? -1 : a.identityId > b.identityId ? 1 : a.edition < b.edition ? -1 : 1
  );
  report.unmatchedPlayers.sort();
  report.unmatchedSpecials.sort();
  report.recordsWithoutImage.sort();
  report.invalidUrls.sort((a, b) => (a.where < b.where ? -1 : 1));

  const snapshot: JetArtSnapshot = {
    version: 1,
    provenance: {
      sourceRepository: 'Gofreamer/cartinhas23',
      sourceCommit: input.sourceCommit,
      capturedAt: input.capturedAt,
      sourceFile: 'seed-cards-import.json'
    },
    entries: sorted
  };
  return { snapshot, report };
}

// ---------------------------------------------------------------------------
// Resolução central: (identityId, edition) → arte.
// Ordem: 1) arte específica da edição 2) arte BASE da identidade
// 3) fallback procedural (a UI decide — aqui retornamos `procedural`).
// Pura e determinística: mesma entrada, mesma saída, sem rede/data/hora.
// ---------------------------------------------------------------------------

export type ResolvedCardArt =
  | { kind: 'remote'; url: string; sourceType: JetArtSourceType; identityId: string; edition: string }
  | { kind: 'procedural'; identityId?: string; edition?: string };

export function artIndexKey(identityId: string, edition: string): string {
  return `${identityId}#${edition.toUpperCase()}`;
}

export function createArtIndex(entries: JetArtEntry[]): Map<string, JetArtEntry> {
  const index = new Map<string, JetArtEntry>();
  for (const entry of entries) {
    const key = artIndexKey(entry.identityId, entry.edition);
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

export function resolveArtWithIndex(
  index: ReadonlyMap<string, JetArtEntry>,
  identityId: string | undefined,
  edition: string | undefined,
  policy: ArtUrlPolicy = {}
): ResolvedCardArt {
  if (!identityId) return { kind: 'procedural', edition };
  const wantEdition = (edition ?? 'BASE').toUpperCase();
  // 1) arte específica da edição (specialImageUrl tem prioridade).
  const specific = index.get(artIndexKey(identityId, wantEdition));
  if (specific && isArtUrlAllowed(specific.url, policy)) {
    return { kind: 'remote', url: specific.url, sourceType: specific.sourceType, identityId, edition: wantEdition };
  }
  // 2) arte BASE da mesma identidade (fallback SOMENTE visual — a edição
  // mecânica da carta não muda).
  if (wantEdition !== 'BASE') {
    const base = index.get(artIndexKey(identityId, 'BASE'));
    if (base && isArtUrlAllowed(base.url, policy)) {
      return { kind: 'remote', url: base.url, sourceType: base.sourceType, identityId, edition: wantEdition };
    }
  }
  // 3) fallback procedural da UI.
  return { kind: 'procedural', identityId, edition: wantEdition };
}
