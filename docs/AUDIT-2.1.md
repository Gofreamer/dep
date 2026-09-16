# JET TCG 2.1 — Auditoria da `main` (2.0.0) e plano de correção

Auditoria factual do commit `d54979b` (merge do PR #7). Cada item foi
**verificado no código**, não na documentação. Legenda:

- ✅ **IMPLEMENTADO REALMENTE** — o código entrega e está ligado ao produto.
- 🟡 **PARCIAL** — existe, mas incompleto, só local, ou não usado na produção.
- 📝 **APENAS DOCUMENTADO** — README/docs afirmam; o código não entrega.
- ❌ **NÃO IMPLEMENTADO**.

## FASE 0 — inventário

| # | Item | Estado 2.0 | Evidência (código) |
|---|---|---|---|
| 1 | Versão | ✅ `2.0.0` | `package.json` |
| 2 | CardDefs JET | ✅ 155 (18 identidades / 28 cartas de agente, 72 ações, 26 equip, 19 campos, 10 energias) | `src/data/jet/*`, dump do registry |
| 3 | Bots | 🟡 24 no código vs **22 na doc** | `src/ranked/bots.ts` (24 entradas) vs `docs/RANKED.md:32`, `docs/RELATORIO-V2.md:90`, `CHANGELOG.md:23` |
| 4 | Ranks | ✅ 8 ranks + Rei da Liga derivado | `src/ranked/ranks.ts` |
| 5 | Rotas Ranked | 🟡 8 rotas, sem limite de taxa em `/ranked/*` | `worker/src/rankedApi.ts` |
| 6 | Tabelas D1 | 🟡 4 tabelas; sem `seasons`, `season_results`, peak/best | `worker/migrations/0001_ranked.sql` |
| 7 | Bindings do Worker | 🟡 só `JET_ROOM` (DO); **sem `JET_DB`** | `worker/wrangler.toml` (bloco D1 comentado) |
| 8 | Env vars | 🟡 `VITE_MULTIPLAYER_URL` no `.env.example`; **`VITE_RANKED_API_URL` ausente** | `.env.example` |
| 9 | CI pós-PR #7 | ✅ run 34735369444 verde; `Workers Builds: dep` verde | `gh run list`, check-runs do `main` |
| 10 | Scripts meta | 🟡 roda, mas usa `--soft` na CI e a matriz **não é** simétrica | `.github/workflows/ci.yml`, `src/meta/simulator.ts` |
| 11 | Bot ladder sim | 🟡 só memória (`MemoryRankedRepo`) | `scripts/bot-ladder-sim.ts:98` |
| 12 | Season | 📝 constante TS; nada persistido | `src/ranked/seasons.ts` |
| 13 | Matchmaking | ❌ usa `bot.initialRating` (rating inicial, não o atual) | `worker/src/rankedApi.ts` `pickBotForRating`, `src/ranked/matchmaking.ts` `findOpponent` |
| 14 | Replay server-side | ✅ reexecuta no engine e valida | `src/ranked/replay.ts` |
| 15 | Auth | 🟡 PBKDF2+salt ok, mas **fallback `dev-secret-change-me`** e limite de taxa só em memória do isolate | `worker/src/rankedApi.ts:197`, `worker/src/auth.ts:88` |
| 16 | Frontend Ranked | 🟡 perfil mostra menos campos que a doc; nomes de bot vêm do backend | `src/ui/screens/RankedScreen.tsx` |
| 17 | Deploy do Worker | 🟡 sem `migrations_dir` ativo, sem cron, sem D1 | `worker/wrangler.toml` |
| 18 | Tratamento de ID de bot na UI | ✅ mostra `botName` do servidor | `RankedScreen.tsx` |
| 19 | Ladder agendado (`scheduled`) | ❌ não existe handler `scheduled` | `worker/src/index.ts` |
| 20 | `every-card` JET | ✅ teste dedicado | `tests/every-card-jet.test.ts` |
| 21 | Teste de D1 real | ❌ todos os testes usam `MemoryRankedRepo` | `tests/ranked*.test.ts` |

## Defeitos confirmados que a 2.1 corrige

1. **`attackCostReduce` não tem piso** — `impulso-kof (−1E)` + `catalisador (−1E)`
   zeram o custo de qualquer ataque: `Ultimato KOF` (180 de dano por 5E) sai por
   3E e o ataque de 2E sai **de graça, no turno 1, com 0 Energia conectada**.
   É a causa estrutural da dominância aggro. → piso de 1 Energia em
   `rules.ts` (fonte única, valendo para `legalActions` **e** `dispatch`).
2. **Nenhum agente do Core Set tem fraqueza/resistência**, mas `ignoreResistance`
   aparece no texto de finishers e a README documentava "Fraqueza ×2,
   resistência −30" como regra viva do JET. Regra existe na engine (`config.damage`
   + `shared.ts:180`); o conteúdo não a exercita.
   → **decisão revisada**: NÃO adicionar afinidades aos 18 agentes — isso seria
   inventar conteúdo canônico. O que foi feito: os textos de carta que
   prometiam `ignoreResistance` batem com a flag real (`equipment.ts:105,139`),
   e a README passou a dizer exatamente onde a regra vale e onde o conjunto não
   a usa.
3. **Arquétipos de fação pequena são matematicamente inviáveis**: `platinum`,
   `weigon` e `salvatore` têm **1 identidade de agente** (limite de 4 cópias por
   identidade). Platinum entra em campo com **4 agentes** e `noActiveLoses` —
   qualquer corrida de KO acaba com o baralho. KOF/Morning Star entram com 15.
   → reconstruir os baralhos com alianças entre fações (regra `allowMultipleFactions`
   já existe) e orçamento de dano/defesa coerente.
4. **Avaliador da IA ignora planos condicionais**: `actionScore` não conhece
   `conditionalEffect`, `forceEnemySwitch`, `coinFlip`, `switchActive`, sinergia
   de `marked`/`silence`/`root`, nem o valor de **negar** recurso do oponente.
   Por isso R6/Caçada/Platinum jogam mal e o meta-sim os pune duas vezes.
5. **`STELLA_PROFILE` e `LUNA_PROFILE` existem em `src/engine/ai/profile.ts` e
   não são usados por ninguém** — `bots.ts` reescreve perfis parecidos inline.
   → liga-los (fonte única) e testar que os estilos são diferentes.
6. **Matchmaking por rating inicial** (item 13 acima).
7. **Ladder só em memória** (item 11) — sem `scheduled`, a produção nunca anda.
8. **Ticket não assina temporada nem `matchId`; `matchId` é
   `seed-username-botId`** e a `seed` vem de `Date.now() ^ rating·31` —
   previsível e colidível.
9. **Nome de bot é namespace de conta**: `username` do humano pode colidir com
   `bot-*` (o perfil do bot é indexado pelo mesmo campo).
10. **CI usa `--soft`** no gate de meta (esconde dominância) e o job de release
    não roda every-card/E2E de Ranked com backend real.

## Estado de produção (honesto)

- `wrangler` **não está autenticado** neste ambiente → nada foi criado na
  Cloudflare. Nenhuma afirmação de "produção ativa" é feita nesta versão.
- O que a 2.1 entrega: configuração versionada e verificável
  (`worker/wrangler.toml` + `wrangler.example.toml` + script de preparação),
  migrations numeradas, cron, e um roteiro exato em `docs/PRODUCTION-CHECKLIST.md`.
