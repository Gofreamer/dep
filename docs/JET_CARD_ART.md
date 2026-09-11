# JET TCG — Artes oficiais (Jet Cards)

Integração das artes oficiais dos agentes via repositório público
**`Gofreamer/cartinhas23`** (dados do sistema Jet Cards/Fórum).
Snapshot atual: `Gofreamer/cartinhas23 @ 580c8ee03f9c59d7356a01fb8ae5f50a8423ff03`
— 18 fotos BASE + 10 `specialImageUrl` (28 URLs distintas).

## Arquitetura (standalone)

```text
Gofreamer/cartinhas23 (leitura OFFLINE, só na importação)
  seed-cards-import.json
    players[*].photo|photoUrl|image          → foto BASE
    cards.specials[*].specialImageUrl        → arte da edição especial
            │
            ▼  scripts/import-jet-card-art.ts (npx tsx | npx vite-node)
src/data/jet/artSnapshot.ts                  ← snapshot versionado + proveniência
            │
            ▼  src/data/jet/art.ts — resolveCardArt() (ÚNICA fonte de verdade)
src/ui/components/CardArt.tsx                ← <img> remota ou Artwork procedural
```

- As imagens **NÃO** são copiadas para este repositório.
- Runtime **NUNCA** consulta `cartinhas23`, Fórum ou Firebase — só as URLs
  públicas das próprias imagens (com fallback procedural se falharem).
- `CardDef`, `MatchState`, saves e `localStorage` **NUNCA** carregam URLs,
  blobs ou base64 — o fluxo é sempre
  `cardId → CardDef → resolveCardArt() → URL` (compatível com futuro
  multiplayer que transmite só `cardId`/`command`/`state`).

## Lógica de resolução (preservada do Jet Cards)

`js/utils/photos.js` + `js/features/cards/cards-ui-card.js`:

```text
specialImageUrl da edição especial
  ↓ (não existe)
foto BASE do agente (photo → photoUrl → image)
  ↓ (não existe)
fallback procedural do JET TCG (Artwork atual — só visual)
```

Ordem no resolver: 1) arte específica da edição → 2) arte BASE da
`identityId` → 3) `{ kind: 'procedural' }`. O fallback edição→BASE é
**somente visual** — a edição mecânica da carta não muda.

## Matching fonte → identidades canônicas

- Chave: **nome normalizado** (case, espaços, acentos, caracteres especiais,
  URL encoding — ex.: `Tayná Lannister Müller` ≡ `tayna lannister muller`).
  A normalização serve **só para comparação**; o nome canônico exibido nunca
  muda. Ver `normalizeAgentName()`.
- **Equipe NUNCA é chave.** Dado legado com equipe divergente (caso real:
  Mik Kashnov ICON com `team: 'Bastard'` na fonte vs `Morning Star` no TCG)
  é associado pela identidade com warning `legacy-team` — nunca cria um
  segundo agente.
- **Ambiguidade real** (2+ identidades canônicas com o mesmo nome
  normalizado) é rejeitada: vai para `ambiguous`, sem chute.
- Fotos BASE duplicadas / especiais duplicados para a mesma chave: mantém a
  primeira, warning `duplicate-base` / `duplicate-special`.

## Edições (mapeamento explícito)

Campo `edition` da fonte → canônico TCG (`ART_EDITION_ALIASES`):

| Fonte | TCG |
|---|---|
| `BASE` | `BASE` |
| `MVP` | `MVP` |
| `CHAMPION`, `CHAMPIONS` (histórico) | `CHAMPION` |
| `FINALS`, `FINAL` (histórico) | `FINALS` |
| `ICON`, `ICONE` | `ICON` |

Edições futuras desconhecidas são **aceitas** (normalizadas em MAIÚSCULAS)
com warning `unknown-edition` — nunca descartadas em silêncio.

## Política de URL

- Toda origem pública HTTPS é tratada como "URL de arte" (GitHub, GitHub
  Pages, Imgur, outras) — sem ramificar por provedor.
- Produção: só `https:`. `http:` apenas com opt-in explícito de dev
  (`--allow-http` / `allowHttp`). `javascript:`, `data:`, `file:` etc.
  são sempre rejeitados (`isArtUrlAllowed()`).
- URLs `github.com/.../blob/...?raw=true` são mantidas **como publicadas**
  (funcionam no navegador via redirect para o raw); reescrevê-las sem
  necessidade arriscaria quebrar arte funcional.
- Sem `dangerouslySetInnerHTML`; `alt` é texto puro.

## UI

- `<CardArt def fit eager />` (`src/ui/components/CardArt.tsx`): resolve,
  lazy-load (`loading="lazy"`, `eager` só no crítico da partida), trata
  `onError` → procedural, sem loop de erro.
- Usado em: `CardView` (carta integral), `CardMini` (mão/listas),
  `BoardCard` (ativo/reserva, `eager`), prévia de agentes na seleção de
  baralho. Modais de inspeção, coleção, builder, tutorial e partida herdam
  automaticamente.
- `object-fit: cover` (padrão, sem distorcer) dentro dos boxes existentes
  (todos com `overflow: hidden`) — a imagem nunca estoura a carta.
- `preloadCardArt()` na partida: só os dois decks em jogo, best-effort via
  `requestIdleCallback`/`setTimeout`, nunca bloqueia. Cache = HTTP normal do
  navegador (sem base64/`localStorage`/saves).

## Atualizar as artes (fluxo futuro)

```bash
# 1. Fotos/cards atualizados no Gofreamer/cartinhas23.
# 2. Clone temporário SOMENTE para leitura (fora do repo do TCG):
rm -rf /tmp/cartinhas23
git clone --depth 1 https://github.com/Gofreamer/cartinhas23.git /tmp/cartinhas23

# 3. Rode o importador (gera src/data/jet/artSnapshot.ts + auditoria):
npx tsx scripts/import-jet-card-art.ts
# alternativa sem baixar nada: npx vite-node scripts/import-jet-card-art.ts

# 4. Confira a auditoria impressa (contagens, inválidas, ambíguas, warnings),
#    rode a suíte e commite o snapshot:
npm run typecheck && npm test && npm run build
```

Opções: `--source <seed.json>`, `--source-dir <clone>`, `--commit <sha>`,
`--out <arquivo>`, `--allow-http` (só dev), `--check` (falha se o snapshot
estiver desatualizado — útil em CI).

Não há sincronização automática em runtime: toda atualização é deliberada
(importador → snapshot → commit/PR).

## Auditoria atual (2026-09-11, fonte @ `580c8ee`)

| Métrica | Valor |
|---|---|
| Jogadores lidos | 127 |
| Especiais lidos | 10 |
| Agentes BASE do TCG com arte | 18 de 18 (nenhum sem arte) |
| Especiais jogáveis com arte própria | 10 de 10 (nenhum sem arte) |
| URLs distintas (snapshot) | 28 — GitHub 20, Pages 6, Imgur 2, outras 0 |
| URLs distintas (fonte inteira) | 136 — GitHub 106, Pages 25, Imgur 5, outras 0 |
| URLs inválidas | 0 |
| Registros sem imagem | 1 (`Platinum_Oscar`, fora do TCG) |
| Sem matching (elenco fora do TCG — esperado) | 109 jogadores, 0 especiais |
| Ambíguos | 0 |
| Warnings | 1 (`legacy-team`: Mik Kashnov ICON, `Bastard` vs `Morning Star`) |

## Testes

`tests/jet-card-art.test.ts` (32 testes): matching BASE/edição, prioridade
`specialImageUrl`, fallbacks, Imgur/GitHub/Pages, protocolos rejeitados,
acentos, URL encoding, equipe legada, ambiguidade, determinismo, gameplay
intacto (CardDefs sem URL, variantes = BASE em HP/recuo/PV), arte fora de
saves e de `MatchState`, e a auditoria do snapshot real.
