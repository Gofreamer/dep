# JET TCG 2.1 — Liga Ranqueada (vs Bots)

A Liga Ranqueada é **humano vs bot**, servidor-autoritativo. Não existe
matchmaking público entre humanos: multiplayer privado continua humano vs
humano, sem rank e sem login.

Tudo abaixo é o que `src/ranked/*` + `worker/src/*` fazem hoje. Onde a 2.0
prometia mais do que entregava, este arquivo foi reescrito (não "completado"
no sentido de promessa).

## Ranks

Hierarquia fixa, **derivada de `RANKS`** em `src/ranked/ranks.ts` (a UI da
temporada lê a progressão de lá — a 2.0 tinha uma cópia da tabela
dentro de `RankedScreen.tsx`):

```
FERRO < BRONZE < PRATA < OURO < PLATINA < DIAMANTE < MESTRE < CAMPEÃO
```

- **CAMPEÃO** é o rank normal máximo (piso 2000 de rating).
- **REI DA LIGA** NÃO é um rank ganho por pontos: é o título de quem está em
  **CAMPEÃO dentro do Top 10 global** (`leaderboard`/`applyRankedResult`).
  Logo, pode haver mais de um portador no mesmo instante — é isso que o código
  faz, e é isso que `top10`/`wasLeagueKing` significam.
- Transições dinâmicas: subir exige vitória, cair exige derrota (`transition`).
- `highestRank` grava o **melhor rank já atingido** na temporada: cair de Elo
  não apaga o currículo.

## Rating (Elo) e progresso do perfil

- Rating inicial: **1000** (Ferro).
- Fator K por faixa (ratings altos mudam mais devagar); **delta mínimo de 1** —
  vencer sempre move, então o topo pode ser tomado.
- Cada `rankedMatchId` é aplicado **exatamente uma vez** (`applyRankedResult`
  é idempotente; o `finish` responde `alreadyApplied: true` num reenvio).
- O perfil guarda `peakRating` (maior rating da temporada — não regride quando
  o Elo cai) e `bestPosition` (melhor posição ocupada) — ambos lidos da
  `profile`/`finish` e exibidos em `RankedScreen` (`data-testid="ranked-peak"`).

## Bots (24 — número derivado, nunca digitado)

- `BOT_ROSTER` em `src/ranked/bots.ts` é a única lista; `BOT_COUNT = BOTS.length`
  e todo texto/rota que fala de quantidade usa `BOT_ROSTER.length` / `BOT_COUNT`
  (a rota `/ranked/ladder` responde `bots: BOT_ROSTER.length`).
- Cada bot tem **apelido de usuário** (ex.: `CaduNogueira`, `vex_exe`,
  `Ancorinha22`), `id` canônico estável (`bot-*` — o `id` é o que vira
  `username` no banco; renomear o apelido não migra nada), arquétipo fixo,
  rating inicial e dificuldade declarada.
- Os dois âncoras mantêm os nomes e dificuldades originais: **StellaPrime**
  (aggro, 2460, 90%) e **Luna underdog** (control, 2390, 86%). Os perfis de IA
  dos dois vêm de `STELLA_PROFILE`/`LUNA_PROFILE` (`src/engine/ai/profile.ts`)
  — na 2.0 essas constantes existiam sem uso e o roster duplicava pesos
  parecidos inline.
- **Nenhum bot tem posição travada**: humano (ou outro bot) pode ultrapassar
  StellaPrime e tomar o #1. É o que `tests/ranked.test.ts` mede.
- Cada bot joga **um** arquétipo e o escolhe antes de ver informação privada
  do humano — não existe contra-pick.
- `isReservedUsername`: o apelido de qualquer bot é **reservado** contra
  humanos. A comparação remove separadores, então `Luna underdog`,
  `luna_underdog`, `Luna-Underdog` e `LUNAunderdog` são o mesmo handle e todos
  dão **409** no cadastro (a 2.0 permitia um humano se registrar como
  `luna_underdog` e aparecer ao lado do bot no ladder).

## Matchmaking

`findOpponent(repo, rating)` (`src/ranked/matchmaking.ts`) casa o humano com o
bot pelo **rating persistido no banco**, não pelo `initialRating` congelado, e
devolve `reason: 'close' | 'challenge' | 'smurf' | 'ladder-top'` conforme a
janela. `seedBots` só cria quem ainda não existe (reexecutar não reseta bots) e
a lista de bots é semeada no primeiro `start` de um banco vazio.

## Anti-trapaça (o cliente nunca decide o resultado)

1. O cliente envia apenas o **baralho** (validado server-side por
   `validateSubmittedDeck` → `validateDeck`: 60 cartas, teto por
   `identityId` com `maxCopiesPerIdentity`) e a **sequência de comandos do
   humano** (incl. escolhas mid-effect).
2. O servidor **repete a partida** no MatchEngine real (`src/ranked/replay.ts`
   + `replayMatch`), gerando os comandos do **bot ele mesmo** (IA
   determinística, sem informação privada).
3. Comando ilegal → submissão **rejeitada** (`ReplayError` → 400).
4. O vencedor é lido do estado final do engine — nunca do payload.

### O ticket (v2)

`POST /ranked/start` assina (HMAC-SHA256) um ticket contendo
`{ v: 2, u, s: seed, b: botId, seat, d: deck, t, sid: seasonId, mid: matchId, n: nonce }`:

| Campo | Para que serve |
|---|---|
| `u` + `n` | dono + nonce → duas partidas do mesmo jogador nunca compartilham `mid` |
| `mid` | chave de idempotência do `finish` (`rm-<temporada>-<usuário>-<bot>-<nonce>`) |
| `sid` | trava o resultado na temporada em que a partida foi aceita |
| `d` | o servidor revalida o baralho que o ticket autorizou |
| `seat` | fixo em **0** (o humano nunca depende do resultado de um sorteio para saber o assento) |
| `s` | seed da partida, vinda de `crypto.getRandomValues` (o servidor sorteia; ninguém escolhe embaralhamento) |

`verifyTicket` recusa: assinatura errada, `v !== 2`, `t` mais de **60 s no
futuro**, idade > **2 h** (TTL = janela de reconexão), e dono diferente do
token (403 em todos os casos).

### Limites e códigos de erro

| Situação | Resposta |
|---|---|
| `JET_RANKED_SECRET` ausente/fraco (<32 chars) | **503** em `start`/`finish` (fail-closed); leitura segue **200** |
| fallback de segredo em produção | só com opt-in explícito: `NODE_ENV=development`/`test` ou `ALLOW_INSECURE_ORIGIN=1` |
| nome de usuário pertencente a um bot | 409 |
| username fora de `a-z0-9_-` (3–24) ou senha fora de 8–128 | 400 |
| baralho inválido | 400 |
| temporada liquidada e fora da graça | 423 |
| `sid` do ticket não existe no banco | 409 |
| mais de `MAX_REPLAY_COMMANDS` (4000) comandos | 413 |
| replay que não termina como declarado / comando ilegal | 400 |
| sem D1 (`JET_DB` sem binding) | 503 em `/auth/*` e `/ranked/*` (degradação segura) |

## Seasons (lidas do banco)

- A janela mora em `seasons.ts` (`SEASON_1`: 90 dias a partir de
  2026-09-12 + 7 dias de graça) **e** na migration `0002_ranked_seasons.sql`,
  que semeia a linha `season-1`. O teste de migração compara os dois, para o
  SQL e o TypeScript não divergirem.
- `activeSeason(repo)` / `seasonAcceptsMatch(season)` são a fonte do worker:
  `start` e `finish` só aceitam dentro de `active`/`grace`.
- `ensureSeasons` abre a **Season 2** (`startAt = fim + 1 dia`) quando o relógio
  passa da janela liquidada — a escada não fica órfã de temporada.
- `settleSeason(repo, seasonId)` grava `season_results`: `finalRating`,
  `peakRating`, `finalPosition`, `bestPosition`, `highestRank`,
  `wasLeagueKing`, `leagueKingPeakPosition` (a melhor posição que o rei ocupou)
  e `wins`/`losses`. Rodar de novo produz as mesmas linhas.
- Rotas: `GET /ranked/season` (temporada + Top 10, pública) e
  `GET /ranked/season/results?season=...` (standings liquidados). A tela lê as
  duas; nada de "temporada" calculada no cliente.

## Escada viva: cron `scheduled`

`worker/src/index.ts` exporta `scheduled(event, env, ctx)` → `runLadderTick`
(`src/ranked/ladderTick.ts`) com `ctx.waitUntil`, agendado em
`worker/wrangler.toml`:

```toml
[triggers]
crons = ["7 * * * *"]
```

Em cada hora o tick: (1) resolve a temporada ativa no banco — fora da janela,
não joga nada; (2) sorteia quantas partidas aquela hora faz, **2–8**, via PRNG
da própria hora (reprodutível); (3) pareia vizinhos de rating no ranking vivo
(±1–2 posições); (4) aplica `applyRankedResult` com
`matchId = ladder-<temporada>-<hora>-<slot>` (reexecutar a hora → já aplicado,
não pontua duas vezes); (5) roda `purgeExpiredSessions`.

**O que o tick NÃO é:** ele amostra a **expectativa Elo** (`expectedScore`)
para decidir o vencedor — não reproduz partidas do MatchEngine. Rodar 8 partidas
IA×IA por hora dentro do Worker é hostil à CPU do plano e o resultado bot×bot
não afeta o rating de nenhum humano; o bot×bot real, jogado no engine, é o que
`npm run ranked:sim` mede (a CI roda 1000 partidas assim).

## Contas e sessões (D1)

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`.
- Senha **nunca em claro**: PBKDF2-SHA256 com **120 000** iterações + salt
  aleatório (`worker/src/auth.ts`).
- Token de sessão aleatório (256 bits), TTL de **30 dias**; sessão vencida é
  eliminada na leitura e pelo `purgeExpiredSessions` do cron.
- **Rate limit** por IP+rota: 30 req / 60 s nas rotas de auth (429).
- Contas são exigidas **apenas** para Ranqueada/perfil/ladder. Multiplayer
  privado e casual vs IA continuam sem login.

## Rotas

| Rota | Auth | Descrição |
|---|---|---|
| `GET /ranked/ladder?limit=100` | não | ranking global (bots inclusos) + `bots: BOT_COUNT` + `season` |
| `GET /ranked/profile` | sim | `profile`, `details` (pico/melhor posição/highestRank), `seasonResult`, `history` **só das partidas desta conta** |
| `GET /ranked/season` | não | temporada ativa (janela, status, `settledAt`) + Top 10 |
| `GET /ranked/season/results` | não | standings liquidados (`?season=season-1`) |
| `POST /ranked/start` | sim | matchmaking por rating vivo + ticket v2 assinado |
| `POST /ranked/finish` | sim | replay server-side + Elo idempotente + pico/posição |

## Deploy / D1

O binding D1 **não** vive em `worker/wrangler.toml` (exigiria um
`database_id` que não existe antes de criar o banco). O passo a passo está em
`worker/wrangler.example.toml`:

```bash
cp worker/wrangler.example.toml worker/wrangler.local.toml
npx wrangler d1 create jet-tcg-db            # imprime o database_id (cole no arquivo local)
npx wrangler d1 migrations apply jet-tcg-db --local     # 0001 + 0002 (migrations_dir)
npx wrangler d1 migrations apply jet-tcg-db --remote
npx wrangler secret put JET_RANKED_SECRET    # >= 32 caracteres
npx wrangler deploy --config worker/wrangler.local.toml
```

`worker/migrations/0001_ranked.sql` está publicada: **nunca é editada** —
mudanças vão para `0003_*.sql` e o `wrangler d1 migrations apply` cuida do
ledger.

| Var | Obrigatória | Uso |
|---|---|---|
| `CLIENT_ORIGINS` | sim (prod) | origens permitidas (WS/CORS) |
| `JET_DB` (binding D1) | sim (ranked) | contas/sessões/ladder/temporadas |
| `JET_RANKED_SECRET` | sim (ranked) | assinatura dos tickets; sem ela, escrita = 503 |
| `NODE_ENV` | não | `development`/`test` liberam o fallback de segredo local |
| `ALLOW_INSECURE_ORIGIN=1` | não | só testes locais |

Frontend: `VITE_RANKED_API_URL` aponta para o Worker (mesma convenção de
`VITE_MULTIPLAYER_URL`). Sem ela, a Liga mostra "não configurada" e o resto do
jogo continua funcionando.

### O que está verificado e o que não está

- **Verificado neste ambiente** (sem conta Cloudflare): as migrations aplicam
  num SQLite real com `0001 → 0002`, backfill e reabertura de arquivo
  (`tests/jet-d1-migrations.test.ts`); os handlers HTTP rodam contra
  `MemoryRankedRepo` e `D1RankedRepo` no mesmo contrato (`tests/ranked-api.test.ts`);
  `wrangler dev --local` sobe o Worker no job `worker-integration` da CI.
- **NÃO verificado**: `wrangler d1 create/migrations apply --remote`, o bind
  real do `[[d1_databases]]`, a execução do cron na borda e um deploy de
  `Jet TCG` num projeto Cloudflare seu. Nada aqui deve ser lido como "produção
  ativa" — veja `docs/PRODUCTION-CHECKLIST.md`.

## Testes

- `tests/ranked.test.ts` — rating, ranks, bots, apelidos/monotonicidade de
  dificuldade, ladder, idempotência, Top 10/Rei da Liga, "humano ultrapassa
  StellaPrime", matchmaking por rating vivo, seasons.
- `tests/ranked-replay.test.ts` — replay reproduz o vencedor, rejeita comandos
  adulterados/incompletos, valida baralho.
- `tests/ranked-api.test.ts` — contrato HTTP + segurança (forja de ticket,
  ticket do futuro/expirado/v1, dono errado, baralho ilegal, 413, nomes
  reservados, 503 fail-closed, unicidade de `matchId`).
- `tests/jet-d1-migrations.test.ts` — SQL real: migrations, backfill,
  persistência de bots/resultados/temporadas, tick agendado e `settleSeason`.
- `e2e/ranked.spec.ts` — fluxo E2E real (registro → ladder → partida → rating),
  pulado quando não há Worker+API apontados.
