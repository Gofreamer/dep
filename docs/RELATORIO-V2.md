# JET TCG 2.0 — Relatório Final

**Branch:** `feat/jet-tcg-2-ranked-core-meta` · **Versão:** 2.0.0

Este relatório acompanha o PR "JET TCG 2.0 — Core Set completo, meta e Liga
Ranqueada contra IA". Ele NÃO é uma declaração de conclusão parcial: cada
subsistema abaixo existe, está testado e está ligado ao produto.

---

## 1. Conteúdo do Core Set JET (contagem por categoria)

Fonte da verdade: `src/data/jet/metrics.ts` → `registryReportText()`.

```
===== REGISTRY REPORT =====
JET CardDefs reais: 155
  Agentes BASE: 18
  Edições (variantes): 10
  Energia: 10
  Técnicas: 48
  Equipamentos: 26
  Campos: 19
  Equipe/sinergia: 24
  Identidades de agente: 18
Fixture/test CardDefs: 0   (no registro de produção)
Outros CardDefs: 0
Total registry em teste: 155
```

### Fixture / dev (separado, nunca registrado em produção)

O pack **NEXO** (`src/data/fixtures/nexo/`) permanece no repositório apenas
para testes/dev e **não é registrado** no build de produção (`main.tsx` chama
só `registerJetDataPack()`):

```
NEXO fixture total: 103 CardDefs
  Characters: 43 · Resources: 12 · Actions: 30 · Equipment: 12 · Fields: 6
```

- **JET production pack** é 100% separável das fixtures (prefixos
  `agent-/jres-/jact-/jeq-/jfd-/jsyn-` vs `char-/res-/act-/eq-/fd-`).
- Nenhuma fixture é contada como carta JET em nenhum número acima.

### Curva de dano (soft, validada nos dados)

| Custo | Dano típico |
|---|---|
| grátis (ação) | 10–20 |
| 1E | 15–40 |
| 2E | 40–75 |
| 3E | 70–115 |
| 4E | 105–160 |
| 5E | 150–220 |

Finishers de dano puro: 4E 130–150 (Colisão Tubarão 140, Tiro Decisivo 150,
Caçada Final 130) e 5E 170–200 (Impacto KOF 180). OHKO é limitado (nada > 200
num golpe; Resistência/Tenacidade absorvem o pico).

### Arquétipos & precons

- **8 arquétipos competitivos** (aggro, control, midrange, burst, disruption,
  tempo, sustain, combo) — `src/data/jet/archetypes.ts`, cada um com deck de
  **60 cartas validado** (`validateDeck`).
- **3 precons de 60 cartas** (`src/data/jet/starterDecks.ts`): Pressão KOF 12,
  Muralha Asgard, Comando Morning Star.

---

## 2. Meta-simulação (≥1000 partidas)

`npm run meta:sim -- --games 16` → **1024 partidas IA×IA** no MatchEngine real
(determinísticas por pareamento, alternância de quem começa). Relatório:
`reports/meta.md` + `reports/meta.json` (win rates, matriz de matchup, dano,
cura, energias, KOs, cartas mais/menos/nunca usadas).

Veja `docs/META.md` para a interpretação dos números e as alavancas de
rebalanceamento. O script avisa (exit 1, ou `--soft` em CI) quando há
dominância universal (>65%).

---

## 3. Liga Ranqueada (humano vs bot, servidor-autoritativo)

- **Ranks**: FERRO → BRONZE → PRATA → OURO → PLATINA → DIAMANTE → MESTRE →
  CAMPEÃO; **REI DA LIGA = CAMPEÃO no Top 10 global**; transições dinâmicas
  (subir exige vitória, cair exige derrota).
- **Elo** com delta mínimo 1 e aplicação **idempotente** por `rankedMatchId`.
- **22 bots** com perfis de IA escaláveis (Ferro→Rei da Liga);
  **StellaPrime** (#1 inicial, 90%, elite, aggro) e **Luna underdog** (#2
  inicial, 86%, hard, control) — **sem trava de posição**: humano pode
  ultrapassar e tomar o #1 (testado).
- **Anti-trapaça**: o cliente envia comandos; o servidor **repete a partida**
  (replay) e decide o vencedor. Comandos adulterados → rejeitados.
- **D1 + auth**: contas (username+senha com **PBKDF2-SHA256 + salt**), token
  de sessão, **rate limit**. Contas só para Ranqueada/perfil/ladder;
  multiplayer privado e casual vs IA sem login.
- **UI**: tela da Liga com login/registro, perfil, Top 100, Top 10 = Rei da
  Liga, matchmaking e partida vs bot.
- **Bot ladder simulation**: `npm run ranked:sim` (lotes bot×bot, ladder vivo).
- **Season 1** com janela de graça de 7 dias e **janela de reconexão** (ticket
  assinado de 2h).

Detalhes: `docs/RANKED.md`.

---

## 4. IA escalável (sem trapaça)

- `src/engine/ai/profile.ts` — `AiProfile` + níveis easy/normal/hard/elite
  (searchDepth 0/0/1/2, beam, blunderRate) e perfis StellaPrime/Luna.
- `src/engine/ai/ai.ts` — pontuação de todas as jogadas legais sobre o estado
  **público** + lookahead determinístico. A IA **nunca** vê mão/deck do
  oponente, não controla RNG, não ganha Energia grátis e não ignora custos.

---

## 5. Testes e CI

**Vitest (1203 testes verdes, 15 skipped = worker-live sem servidor):**

- every-card JET (`tests/every-card-jet.test.ts`, `every-card-playable.test.ts`);
- fuzz IA×IA (smoke 60 + **longo 1000** via `npm run test:fuzz:long`);
- engine, fluxo, invariantes, persistência, statuses, edições, cards, produção;
- **ranked** (`ranked.test.ts`, `ranked-replay.test.ts`, `ranked-api.test.ts`);
- UI real (`ui-app.test.tsx` — menu agora com 8 entradas incl. Liga Ranqueada).

**Worker:** `typecheck:worker` + integração real (`test:worker`, wrangler dev +
Durable Object + WebSocket).

**E2E (Playwright):** smoke, flow, responsive, stress, multiplayer (2
navegadores), e **ranked** (`e2e/ranked.spec.ts`).

**CI** (`.github/workflows/ci.yml`) cobre: typecheck (app+worker), vitest,
bateria longa, **fuzz 1000**, **meta sim**, **bot ladder sim**, build, worker
integration, E2E desktop/mobile/tablet e E2E multiplayer.

---

## 6. Pontos de atenção honestos

1. **Dominância da IA**: a meta-simulação favorece planos diretos (aggro/
   control/midrange) sobre planos condicionais — é um viés do avaliador IA×IA,
   documentado em `docs/META.md`. Assimetrias de matchup são saudáveis; a
   dominância universal remanescente é reportada como aviso (não silenciada).
2. **D1 não executado em CI**: o worker local (wrangler dev) usa D1 local
   quando disponível; os testes de handler usam `MemoryRankedRepo`. O schema D1
   está em `worker/migrations/0001_ranked.sql` e o deploy está documentado em
   `docs/RANKED.md`.
3. **Arte/balanceamento**: os agentes vêm da fonte oficial (RocksXB); as
   cartas originais (Técnicas/Equipamentos/Campos/Sinergia) são gameplay
   original do TCG, **nunca apresentadas como lore canônico**.
