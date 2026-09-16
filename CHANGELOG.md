# Changelog

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto usa versionamento semântico.

## [2.1.0] — Regras que vieram da carta, meta por causa estrutural, Liga real

Correção do que a auditoria de produção encontrou **no código** (não no
README): cada item abaixo tem teste ou arquivo correspondente.

### Corrigido

- **`attackCostReduce` sem piso**: `impulso-kof` + `catalisador` zeravam o custo
  de qualquer ataque (`Ultimato KOF` de 5E saía por 3E; ataque de 2E, de graça,
  no turno 1). Agora `attackCostFloor: 1` e `maxAttackCostReduce: 1` em
  `rules.ts` — fonte única para `legalActions` **e** `dispatch`
  (`tests/jet-cost-reduce.test.ts`).
- **"1 ACTION por turno" era só config do turno**: carta `ACTION` sem
  restrição própria podia ser repetida. `toTechnique` passa a declarar
  `[{type:'oncePerTurn'}]` como default e `checkRestrictions` é a única fonte
  (`tests/jet-action-once.test.ts`, 6 casos).
- **`maxCopiesPerIdentity` não era imposto** pelo `validateDeck` — identidade
  com 4 cópias por carta permitia 8+ de um mesmo agente. Imposto na validação
  compartilhada pelo produto e pela Liga (`validateSubmittedDeck`).
- **Bots com nome emprestável**: o cadastro não bloqueava variantes do nome de
  bot. `botUsername` agora remove separadores (`Luna underdog` =
  `luna_underdog` = `LUNAunderdog`) e `register` responde 409.
- **Ticket da Liga fraco**: `matchId` era `rm-<usuário>-<seed>` com
  `seed = Date.now() ^ rating·31` (colidia e era previsível), e o ticket não
  assinava temporada nem `matchId`. Agora: seed de `crypto.getRandomValues`,
  `nonce` por partida, `sid`/`mid` assinados, versão `v: 2` recusada se for
  antiga, `t` no futuro (>60 s) recusado, TTL 2 h (142 → contrato em
  `tests/ranked-api.test.ts`).
- **Matchmaking congelado**: o pareamento olhava `initialRating` do roster, então
  o topo da escada nunca mudava de alvo. `findOpponent` usa o rating
  **persistido** (janela ±1–2 posições no ranking vivo).
- **Temporada só no código**: `currentSeason()` era uma função pura e o worker
  não consultava o banco. A temporada passou a ser lida de `seasons`
  (`activeSeason`/`seasonAcceptsMatch`), com `SETTLE`/graça, `ensureSeasons`
  abrindo a Season 2 e `settleSeason` gravando currículo por jogador.
- **Escala da UI**: `RankedScreen` tinha uma cópia local da tabela de ranks e
  não consultava a temporada; agora lê `/ranked/season` e
  `/ranked/season/results` e mostra pico/melhor posição/`highestRank` do banco.

### Adicionado

- **Avaliador de estado para a IA** (`src/engine/ai/eval.ts`) + ruído puro
  (`noise.ts`): planos condicionais (`conditionalEffect`, negação de recurso,
  `marked`/`silence`/`root`, coinFlip) deixaram de ser invisíveis para a IA —
  é por isso que R6/Caçada/Platinum jogavam mal. Blackout R6 foi tratado
  **melhorando a IA antes de buffar carta**.
- **Simulador de meta pareado** (`src/meta/simulator.ts`): ida/volta com o
  mesmo seed, intervalo de confiança, espelhos, matriz de uso de cartas;
  `scripts/meta-sim.ts` com gate 35–65% / matchup 20–80% e sementes literais
  (mesmo commit ⇒ mesmo número, sem flaky de amostragem).
- **Tick da escada** (`src/ranked/ladderTick.ts` + `scheduled()` no worker +
  `crons = ["7 * * * *"]`): 2–8 partidas/hora por PRNG da hora, `matchId`
  determinístico (reexecutar não pontua), purga de sessões vencidas.
- **`worker/migrations/0002_ranked_seasons.sql`**: picos/melhor posição/
  `highest_rank`/`season_id` em `ranked_profiles`, tabelas `seasons` e
  `season_results` e semente da Season 1 (0001 publicada não é tocada).
  Backfill, `INSERT OR IGNORE` e reabertura de banco são cobertos por
  `tests/jet-d1-migrations.test.ts` (SQLite real, SQL das migrations).
- **Fail-closed de segredo**: sem `JET_RANKED_SECRET` (mín. 32 chars) a escrita
  da Liga responde **503** e a leitura continua 200; o fallback `'dev-secret-change-me'`
  da 2.0 só vale com `NODE_ENV=development|test` ou `ALLOW_INSECURE_ORIGIN=1`.
- **`worker/wrangler.example.toml`** com o passo a passo do D1 (`migrations_dir`,
  `wrangler d1 migrations apply`) — sem `database_id` inventado no repo.
- **`/health`** passou a expor `ranked.{d1, secretConfigured, devFallback}`
  (só booleanos: nunca vaza configuração).
- **CI**: o gate de meta roda **sem `--soft`** (8 partidas/par × 8 réplicas =
  2304 partidas), o `ranked:sim` subiu para 1000 partidas, e o relatório de meta
  virou artefato publicado (inclusive quando reprova).

### Documentado como não verificado

- Deploy real na Cloudflare (criação do D1, `--remote`, execução do cron na
  borda): sem conta no ambiente, nada aqui é afirmado como "produção ativa" —
  ver `docs/PRODUCTION-CHECKLIST.md`.
- Fraqueza/resistência e Evolução/Suprema: as **regras** existem na engine; o
  Core Set JET não tem conteúdo que as exercite (afinidade, estágio > 0,
  `ultimate`). Não foram inventadas afinidades nem identidades para "fazer
  número".

## [2.0.0] — Core Set completo, meta e Liga Ranqueada contra IA

### Adicionado

- **Core Set JET (155 CardDefs reais)**: 18 Agentes BASE + 10 edições, 10
  Energias, 48 Técnicas, 26 Equipamentos, 19 Campos, 24 cartas de equipe/
  sinergia. Pack NEXO (103 CardDefs) permanece como fixture/dev, nunca
  registrado em produção.
- **8 arquétipos competitivos** (aggro, control, midrange, burst, disruption,
  tempo, sustain, combo) + **3 precons de 60 cartas**, todos validados.
- **IA escalável sem trapaça**: perfis easy/normal/hard/elite com lookahead
  determinístico; nunca vê informação privada, não controla RNG, não ignora
  custos.
- **Meta-simulação** (`npm run meta:sim`): 1024 partidas IA×IA no engine real,
  matriz de matchup, estatísticas de uso de cartas, relatório markdown/JSON.
- **Liga Ranqueada (humano vs bot, servidor-autoritativo)**: ranks
  Ferro→Campeão com **Rei da Liga = CAMPEÃO no Top 10**, Elo idempotente,
  22 bots (StellaPrime #1, Luna underdog #2, sem trava de posição), anti-
  trapaça por replay server-side.
- **D1 + auth**: contas com PBKDF2-SHA256 + salt, token de sessão, rate limit;
  rotas `/auth/*` e `/ranked/*` no Worker; UI da Liga (perfil, Top 100, Top 10).
- **Bot ladder sim** (`npm run ranked:sim`) e **CI expandido** (fuzz 1000, meta
  sim, ranked sim, E2E ranked).

### Corrigido

- `testTimeout` 120s para a bateria longa de 135 partidas (default de 5s do
  vitest era insuficiente em máquinas lentas).
- Placeholder de D1 removido do `wrangler.toml` (deploy real do Worker).

## [Não publicado] — Hardening v2 (diagnósticos, fuzz, stress de board)

### Adicionado

- **Detector de soft-lock** (`src/engine/diagnostics.ts`): estados impossíveis
  (pending sem candidatos, setup impossível, trigger queue não drenada, ativo
  nulo, derrotados em jogo) + `MatchEngine.diagnose()` com rastro do último
  comando. Não muta estado; usado em testes, debug e (futuramente) no Worker.
- **`resolveDefeats` com promoção automática**: reserva com exatamente 1
  agente elimina o pending desnecessário e a janela de soft-lock no multi.
- **ChoicePanel anti-soft-lock**: toda escolha pendente (mão, descarte,
  opções) é clicável; cartas da mão candidatas resolvem a escolha.
- **Harness every-card** (`tests/every-card-playable.test.ts`, 312 testes):
  cada uma das 155 CardDefs registradas é realmente jogável (deploy, upgrade
  em cadeia, equipamento, técnica, campo) com rigging determinístico.
- **Bateria de fuzz** (`tests/fuzz-matches.test.ts`): 1000 partidas IA×IA
  determinísticas com gates de invariante por partida (conservação de zonas,
  comandos legais, fim real). Resultado da base: 504×496, 0 travamentos.
- **E2E de stress do board** (`e2e/stress.spec.ts`): turno 50, reservas 5+5,
  mão e descarte grandes, status ativos — layout estável em 5 viewports
  (1440×900, 1366×768, 768×1024, 390×844, 360×800) a 100% de zoom, log com
  overflow interno e controles críticos clicáveis após o stress.
- **Instrumentação dev**: `window.__jetDev` (apenas com `settings.devMode`) com
  engine, controller, sync e ops de debug; novas ops `setTurn` e
  `discardHand`. `playwright.config.ts` aceita `PW_CHROMIUM_EXECUTABLE` e
  `PW_NO_VIDEO` para ambientes sem browsers/ffmpeg do Playwright.

### Corrigido

- **Board crescia indefinidamente em partidas longas**: reservas com ataques
  listados e ativos gigantes empurravam o dock de comandos para fora do
  viewport em 1366×768 e 768×1024. Zonas agora têm altura limitada por
  `clamp()`/`vh` (reserva compacta com badges + tooltip, ativo com scroll
  interno), mão 18px mais baixa e media queries por altura (≤800px/≤700px)
  que comprimem o board mantendo dock, banner e mão sempre visíveis.
- **Tutorial duplicava a mesma instância na mão**: `rigTutorialHand` pegava a
  MESMA `jres-energia` duas vezes (mesmo uid `c13`) — warning de key do React
  e carta fantasma. Agora cada ocorrência é uma instância distinta (splice).
- **`mobile-touch` do Playwright usava WebKit** (`devices['iPhone 13']`):
  `browserName: 'chromium'` explícito para o projeto rodar em qualquer CI
  com só o Chromium instalado.

## [1.0.0] - 2026-09-11

Primeira versão jogável completa: campanha contra a IA, tutorial, construtor de
baralhos, coleção, artes oficiais e **multiplayer privado 1×1** com servidor
autoritativo.

### Adicionado

- **Multiplayer privado para 2 jogadores.** Servidor em Cloudflare Worker +
  Durable Object (`worker/`), protocolo tipado e versionado (`src/net/protocol.ts`),
  máquina de sala pura e testável (`src/net/roomCore.ts`) e cliente de WebSocket
  com store Zustand (`src/multiplayer/`). Fluxo: criar sala → código de 6
  caracteres ou link de convite → os dois escolhem baralho → os dois ficam
  prontos → partida → resultado → revanche.
- **Servidor autoritativo.** O cliente envia apenas comandos com `commandId` e
  `revision`; o Worker valida, aplica ao mesmo `MatchEngine` do modo local,
  sobe a revisão monotônica e devolve a visão do jogador. RNG (seed) fica no
  servidor e nunca é enviado. Baralhos são revalidados no servidor.
- **Informação escondida por jogador** (`src/net/view.ts`): mão e baralho do
  adversário chegam vazios com apenas a contagem; `seed`/`rngState` zerados;
  `defId` removido do `CARD_DRAWN` alheio; `pending` e `CHOICE_REQUESTED` só
  para quem decide.
- **Sessão e reconexão.** `seatToken` criptográfico entregue uma única vez e
  guardado em `sessionStorage`; reconexão exige o token (só o código não basta);
  queda durante a partida pausa e mostra "Oponente desconectado"; banner
  "Reconectando…"/"Reconectado." no cliente.
- **Endurecimento do WebSocket.** Allowlist de `Origin` via `CLIENT_ORIGINS`,
  limite de 64 KiB por mensagem, validação de JSON/tipo/campos, janela de
  deduplicação de `commandId`, alarm de TTL por sala, recusa de payload com arte
  binária, `seatToken` mascarado em log e nenhum stack trace interno enviado ao
  cliente.
- **Menu final com 7 entradas** (Jogar vs IA, Multiplayer privado, Tutorial,
  Baralhos, Coleção, Histórico, Ajustes).
- **Efeitos sonoros** gerados por Web Audio (`src/ui/audio.ts`), com liga/desliga
  nos Ajustes e persistidos. Nenhum asset externo; som nunca é requisito.
- **Camada de polish de UX**: `prefers-reduced-motion` respeitado, estados
  desabilitados visivelmente inativos, contraste de textos de apoio, inspeção de
  carta na preparação.
- **Testes**: UI real em jsdom (`tests/ui-app.test.tsx`, 18 fluxos de produto),
  `ErrorBoundary` com render de verdade, protocolo/sala
  (`tests/net-room.test.ts`, 41 casos), integração real do Worker com dois
  clientes WebSocket (`tests/worker-live.test.ts`, 14 casos) e E2E de navegador
  (`e2e/`, 26 casos) — **executados na CI** em Chromium, Firefox, WebKit
  (iPhone 13) e tablet: 24 passed + 2 passed no job multiplayer.
- **CI**: typecheck do app e do Worker, vitest, bateria de 135 partidas,
  auditoria de dependências, build, integração do Worker e E2E (inclusive
  multiplayer com dois navegadores).
- **Documentação**: `worker/README.md` (rodar, protocolo, segurança, deploy),
  `docs/RELEASE-V1.md` (relatório do lançamento) e `.env.example`.

### Corrigido

- **`rawBasePhotoOf`** (`src/integrations/jet/cardArt.ts`) usava
  `player?.photo ?? photoUrl ?? image`, que aceitava string vazia e derrubava a
  arte oficial para o fallback procedural. Agora percorre os três campos
  ignorando valores ausentes ou vazios.
- **Baralho do oponente na seleção** (`src/ui/screens/DeckSelectScreen.tsx`)
  tinha como padrão `'deck-controle-tatico'`, id que só existe num fixture NEXO
  nunca registrado em produção: o `<select>` aparecia sem opção marcada e o
  controller caía num fallback silencioso para o starter 0. O padrão agora é um
  baralho realmente salvo.
- **`vitest` não coletava `tests/**/*.test.tsx`.** `tests/jet-error-boundary.test.tsx`
  nunca foi executado; dois de seus casos chamavam `setState` num componente não
  montado (no-op no React 18) e, portanto, não verificavam nada. Padrão de coleta
  corrigido e o arquivo reescrito com render real.
- **Entrar em sala inexistente criava a sala.** `JOIN_ROOM` com código bem
  formado porém nunca criado abria uma sala fantasma em vez de responder
  `room_not_found`. Agora sala sem jogador presente responde
  "Sala não encontrada. Confira o código.".
- **`FXLayer` só lia cues da partida local**, então jogar online não produzia
  feedback visual. A tradução evento→cue foi extraída para `src/game/cues.ts` e
  a camada agora atende os dois modos sem duplicar regra.
- **Clique em carta não posicionável na preparação não fazia nada**; agora abre
  a inspeção.
- **Escape abria o menu de pausa junto com a inspeção**, deixando um backdrop
  que bloqueava a partida (dois listeners de `keydown` no `window`).
- **Cartas da mão cobriam o dock de ações** em desktop, impedindo o clique em
  "Pronto"/"Encerrar Turno".
- **As primeiras cartas da mão ficavam inalcançáveis** quando a mão transbordava
  (`justify-content: center` + `overflow-x: auto`); agora `safe center`.
- **Dois verde-falsos na CI**: o pipe do E2E sem `pipefail` e o job multiplayer
  que pulava os testes por falta de `VITE_MULTIPLAYER_URL` no ambiente de teste.
- **Erro de digitação** em campo de configuração (`tamnhos` → `tamanhos`) e
  `engines.node` alinhado ao mínimo exigido pelo Vite 8 (`>=20.19`).

### Alterado

- Dependências de desenvolvimento atualizadas (Vite 8, Vitest 5, plugin React 6,
  TypeScript 5.9), eliminando as 5 vulnerabilidades dev-only do baseline.
- Adotados `jsdom` + Testing Library, `@playwright/test`, `wrangler` e `ws`
  (todos dev-only; nenhuma dependência nova em runtime).
- `src/ui/screens/MatchScreen.tsx` e telas de menu/coleção/ajustes receberam
  `data-testid` e atributos ARIA nos pontos usados pelos testes.

[1.0.0]: https://github.com/Gofreamer/dep/releases/tag/v1.0.0
