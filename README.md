# JET TCG

Jogo de cartas colecionáveis competitivo no navegador: **Agente vs IA**, no
universo **JET** (identidade importada do [Jet Tactics](https://github.com/RocksXB/jet-tactics)),
100% em **PT-BR**. Engine genérica e data-driven — todo o conteúdo do jogo é
dado, não código.

> **Status do roster:** a fonte oficial (`RocksXB/jet-tactics`) estava
> inacessível durante o desenvolvimento. A camada de integração está completa
> e testada; agentes, edições e decks starter são preenchidos exclusivamente a
> partir do snapshot oficial — ver `docs/JET_TACTICS_IMPORT.md`.

## Como rodar

```bash
npm install
npm run dev            # abre em http://localhost:5173
npm run build          # build de produção (tsc -b && vite build)
npm run preview        # serve o build em http://localhost:4173
npm test               # suíte de testes (vitest)
npm run test:long      # bateria de 135 partidas IA×IA
npm run test:worker    # integração real do Worker (sobe wrangler dev)
npm run test:e2e       # E2E de navegador (Playwright)
npm run check          # tudo: typecheck + worker typecheck + testes + bateria + build
```

Configuração opcional: copie `.env.example` para `.env` e defina
`VITE_MULTIPLAYER_URL` com o endereço do servidor de salas. **Sem isso o jogo
funciona normalmente** — só o modo multiplayer fica indisponível.

## Arquitetura

```
src/
  engine/            # Núcleo genérico e autoritativo (sem UI, sem strings de tema)
    types.ts         #   Commands, MatchState, CardDef, UltimateDef, configs
    rules.ts         #   FONTE ÚNICA das regras (usada por dispatch E legalActions)
    engine.ts        #   dispatch de comandos, turnos, triggers, debug ops
    effects/         #   motor de efeitos data-driven (ops declarados em dados)
    queries.ts       #   leituras de estado, censo de conservação de cartas
    state/setup.ts   #   criação da partida + mergeConfig (deep merge por seção)
    ai/              #   IA heurística (fácil/normal/difícil), nunca aleatória pura
  data/              # Dados do jogo
    terminology.ts   #   JET TCG: Agente / Energia JET / Técnica / Evolução…
    jet/             #   JET CORE SET: snapshot, perfis de agentes, Energia JET,
                     #   Técnicas, Equipamentos, Campos, starter decks
    fixtures/nexo/   #   conteúdo NEXO legado (apenas para testes/dev)
    statuses.ts      #   status estruturados (engine-genéricos)
  integrations/jet/  # camada Jet Tactics → JET TCG (types, normalize, converter,
                     # importer, provenance) — sem acoplamento em runtime
  game/              # MatchController: ponte engine ⇄ UI (comandos, IA, tutorial)
  net/               # multiplayer compartilhado (protocolo, visão por jogador,
                     #   RoomCore) — puro, roda no Worker E no Node
  multiplayer/       # cliente de WebSocket + store Zustand do modo online
  persistence/       # interface de persistência + adapter localStorage
  ui/                # React: título, menu, seleção de deck, builder, coleção,
                     #   partida local, partida online, ajustes
worker/              # Cloudflare Worker + Durable Object (salas privadas)
tests/               # engine, invariáveis, integração JET, fluxo, UI (jsdom),
                     #   RoomCore e integração real do Worker
e2e/                 # Playwright: fumaça, fluxo, responsivo, multiplayer
scripts/             # import-jet-tactics.ts, run-worker-tests.mjs
docs/                # importação, artes, balanceamento, hardening, release
```

## Conceitos

| Engine (interno) | JET TCG (exibido) |
|---|---|
| `CHARACTER` | **Agente** |
| `RESOURCE` | **Energia JET** |
| `ACTION` | **Técnica** |
| `EQUIPMENT` | **Equipamento** |
| `FIELD` | **Campo** (subtipos ARENA / EVENT / DOMAIN) |
| Active | **Agente Ativo** |
| Upgrade | **Evolução / Transformação** (Base → Forma → Despertar) |
| Victory Point | **Ponto de Vitória (PV)** |

### Character vs Agente; `identityId`

A engine fala de `CHARACTER` genérico. No JET, cada agente tem uma
**identidade** (`identityId`, ex.: `agent-jenny`) e uma ou mais **cartas**
(ex.: `agent-jenny-base`, `agent-jenny-mvp`). Usado para: limites de baralho
por identidade, coleção agrupada, variantes.

### Edition vs Upgrade

`BASE / MVP / CHAMPION / FINALS / ICON` são **variantes colecionáveis** —
side grades, nunca estágios. Transformação real em campo (Base → Forma →
Despertar) exige carta de Evolução: a carta real sai da mão e entra na
**pilha de progressão** do agente — nenhuma carta é criada, clonada ou
descartada (conservação testada). Edição nunca vira estágio (o importador
rejeita).

### Energia JET

Sistema de recursos com suporte a energia genérica, especiais (curinga,
temporária, aceleração, transferência, recuperação, descarte). Afinidades são
configuração de gameplay — nenhum agente recebe elemento arbitrário que a
fonte não forneça.

### Raridade e Holo

Raridade = disponibilidade/complexidade/tratamento visual. **Nunca** números
maiores. Holo é cosmético (testado). Edições especiais são desenhos próprios
com tradeoffs — não "a mesma carta mais forte".

## Regras implementadas

- Setup com mulligan (auto e interativo), ativo/reserva, jogador inicial
  aleatório, primeiro turno sem ataque (configurável)
- Vitória por PV (alvo 4, configurável) + derrotas alternativas (sem
  substituto para o Ativo, deck-out)
- Só Base entra direto em campo; formas avançadas exigem Evolução (sem pular
  estágios por padrão; exceção apenas por efeito explícito)
- Fraqueza ×2, resistência −30, 1 slot de campo, 2 slots de equipamento
  (padrão configurável), recuo paga Energia
- Efeitos/gatilhos/status/alvos 100% data-driven; `legalActions` e engine
  compartilham a mesma fonte de regras
- Configuração parcial via deep merge (nunca apaga propriedades irmãs)
- Baralho: 60 cartas, máx. 4 por carta, limite por `identityId`, exige
  agente inicial Base (`requireBasic`)
- Suprema opcional data-driven (condição + custo + once-per-match)
- RNG centralizado e semeado (partidas reproduzíveis)
- IA heurística com 3 dificuldades (usa as mesmas `legalActions`)
- Tutorial interativo, painel de debug (apenas modo dev), rematch instantânea
- **Multiplayer privado 1×1**: servidor autoritativo, código de sala de 6
  caracteres + link de convite, token de assento para reconexão, revisão
  monotônica e idempotência por `commandId`. Sem contas, sem chat, sem filas —
  ver [worker/README.md](worker/README.md)

## Importação Jet Tactics

Ver **[docs/JET_TACTICS_IMPORT.md](docs/JET_TACTICS_IMPORT.md)** — camadas de
identidade, pipeline `raw → snapshot → perfis → cartas`, proveniência e
política de pendentes (`TCG_PROFILE_PENDING`).

## Guia de balanceamento

Ver **[docs/TCG_BALANCE_GUIDE.md](docs/TCG_BALANCE_GUIDE.md)** — orçamento
interno de custos/efeitos, conversão de papéis (Support/Breaker/Controller/
Guardian/Duelist/Commander) e checklist de carta nova.

## Como estender

- **Novo Agente:** capture na fonte → `src/data/jet/raw/` → `npx tsx scripts/import-jet-tactics.ts` → cure o perfil em `src/data/jet/agentProfiles.ts` (status `CURATED`) → teste.
- **Nova edição:** a fonte precisa listá-la; crie um perfil por edição com a MESMA `identityId` e sidegrade real.
- **Nova Técnica/Equipamento/Campo:** adicione um `CardDef` em `src/data/jet/auxiliares.ts` (efeitos = `EffectStep[]` declarados em dados).
- **Expansão de Domínio (futura):** `FieldDef` com `subtype: 'DOMAIN'` + `override` — só com informação oficial suficiente.
- **Suprema (futura):** `CharacterDef.ultimate` (condição + custo + efeitos).

## Testes

```bash
npm test            # vitest: engine, dados, UI (jsdom), protocolo/RoomCore
npm run test:long   # 135 partidas IA×IA (travas e jogadas ilegais)
npm run test:worker # Worker real (wrangler dev) + 2 clientes WebSocket
npm run test:e2e    # Playwright: Chromium, Firefox, mobile e tablet
```

Cobrem: invariáveis de engine (deploy Base-only, conservação de instâncias
com censo, pilha real de evolução, skip-stage, `characterCondition` idêntico
em legalActions e dispatch, mulligans, `benchAtSetup`, deep merge de config,
identityId/holo/raridade, field override, sweep legalActions↔dispatch),
integração Jet Tactics (conversão, pendentes, proveniência), fluxo completo de
partida, UI real em jsdom (fluxos de produto, ErrorBoundary), protocolo e
máquina de sala do multiplayer, integração real do Worker e E2E de navegador.

O relatório do lançamento está em **[docs/RELEASE-V1.md](docs/RELEASE-V1.md)** e
o histórico em **[CHANGELOG.md](CHANGELOG.md)**.
