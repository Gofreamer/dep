# JET TCG 2.1 — Checklist de produção (Cloudflare)

Este arquivo existe porque a 2.0 tinha o padrão perigoso de **documentar
produção como pronta**. Aqui cada linha ou (a) foi verificada neste ambiente, ou
(b) está marcada como NÃO verificada, com o comando exato para verificar.

## Estado atual deste repositório (o que foi checado de fato)

| Item | Estado | Como foi checado |
|---|---|---|
| Migrations `0001`/`0002` aplicam, com backfill e sem perda de dados | ✅ verificado (SQLite real) | `tests/jet-d1-migrations.test.ts` |
| `D1RankedRepo` conversa com o esquema migrado (perfis, picos, partidas, temporadas, sessões) | ✅ verificado (SQLite real) | idem (reabertura de arquivo inclusa) |
| Handlers HTTP (`/auth/*`, `/ranked/*`) — contrato, tickets, códigos de erro | ✅ verificado | `tests/ranked-api.test.ts` (16 casos) |
| Worker sobe e o multiplayer WebSocket funciona | ✅ verificado em `wrangler dev --local` na CI | `npm run test:worker` |
| Liga E2E de navegador contra Worker real | 🟡 **pulado** sem `JET_WORKER_URL` + build com `VITE_RANKED_API_URL` | `e2e/ranked.spec.ts` |
| `wrangler d1 create` / `migrations apply --remote` / deploy | ❌ **NÃO verificado** — exige conta Cloudflare | — |
| Execução real do cron (`scheduled`) na borda | ❌ **NÃO verificado** | — |
| `[[d1_databases]]` com `database_id` do projeto | ❌ **NÃO verificado** — o `database_id` só existe depois do `d1 create`, e inventar um no repo é proibido | `worker/wrangler.example.toml` |

Nada aqui autoriza a frase "produção ativa da Liga Ranqueada".

## Passo a passo do deploy

```bash
# 0. build e gate local (a CI faz o mesmo)
npm run check
npm run meta:sim -- --games 8 --seeds 8 --level hard --out reports/meta-local.md

# 1. banco
npx wrangler d1 create jet-tcg-db                      # anote o database_id
cp worker/wrangler.example.toml worker/wrangler.local.toml
#    cole o database_id em worker/wrangler.local.toml (NUNCA no wrangler.toml)
npx wrangler d1 migrations apply jet-tcg-db --local    # 0001 + 0002 em local
npx wrangler d1 migrations apply jet-tcg-db --remote   # produção

# 2. segredo (≥32 caracteres; sem ele a Liga recusa escrita com 503)
npx wrangler secret put JET_RANKED_SECRET

# 3. deploy + observabilidade
npx wrangler deploy --config worker/wrangler.local.toml
npx wrangler tail --config worker/wrangler.local.toml  # logs do cron/erros
```

Frontend: `VITE_RANKED_API_URL=https://<worker>` no build (Pages), mesmo padrão
de `VITE_MULTIPLAYER_URL`. Sem essa variável a tela da Liga mostra "não
configurada" e o resto do jogo funciona — é o comportamento esperado, não erro.

## Verificações pós-deploy (execute na ordem)

1. **`GET /health`** → `ranked.d1: true`, `secretConfigured: true`,
   `devFallback: false`. Se `devFallback` for `true` em produção, o segredo está
   ausente e o worker só não quebrou porque alguém liberou o fallback — corrija.
2. **`POST /auth/register`** com nome de bot (`StellaPrime`, `Luna_underdog`) →
   **409**; com `a.b` → **400**; válido → **201** + token.
3. **`GET /ranked/ladder`** → 24 bots (`bots: 24`, derivado de
   `BOT_ROSTER.length`), `season.id = season-1`, StellaPrime em #1 no primeiro
   dia e **sem trava**: acompanhe depois de resultados reais.
4. **`POST /ranked/start`** → 201 com `ticket`/`mid`/`seed`/`seat: 0`; mande o
   mesmo `deck` inválido → **400**.
5. **`POST /ranked/finish`** com o replay de uma partida real → 200 com
   `ratingAfter`/`peakRating`/`position`/`bestPosition`/`alreadyApplied: false`;
   reenvie o MESMO ticket → `alreadyApplied: true` e rating inalterado.
6. **Temporada**: `GET /ranked/season` → janela/status coerentes com o banco
   (não com o cliente). Depois da data de fim + 7 dias, `finish` → **423**.
7. **Cron**: espere a próxima hora (:07) e confira em `wrangler tail` a linha
   do tick (`runLadderTick` joga 2–8 partidas do lote da hora, idempotente por
   `ladder-<temporada>-<hora>-<slot>`). `SELECT COUNT(*) FROM ranked_matches`
   deve subir junto.
8. **Persistência**: `npx wrangler d1 execute jet-tcg-db --remote --command
   "SELECT username, rating, peak_rating, best_position FROM ranked_profiles
   ORDER BY rating DESC LIMIT 10"` → bate com `GET /ranked/ladder`.
9. **Liquidação** (fim de temporada): `npm run` do caminho de `settleSeason`
   (rotina de manutenção/admin) e então `GET /ranked/season/results` → linhas
   com `finalRating`/`peakRating`/`finalPosition`/`bestPosition`/`highestRank`/
   `wasLeagueKing`.

## Separar erro de código de erro de configuração

| Sintoma | Causa provável | Confirma com |
|---|---|---|
| `/ranked/start` → **503** `JET_RANKED_SECRET ausente` | segredo não posto / <32 chars | `wrangler secret list`, `/health.ranked.secretConfigured` |
| `/ranked/start` → **401** sempre | token expirado (30 dias) ou D1 sem tabela `sessions` | `SELECT * FROM sessions LIMIT 1` |
| `/ranked/*` → **503** com `ranked.d1: false` | binding ausente no config usado pelo deploy | `wrangler deploy --config <o mesmo>` + `wrangler config validate`? (não existe: compare o arquivo usado) |
| Deploy reclama de `database_id` | arquivo errado ou id de outro projeto | `wrangler d1 list` |
| Migrations "already applied" parciais | ledger local antigo | `wrangler d1 migrations list jet-tcg-db --local` |
| Cron sem log na hora certa | `[triggers] crons` ausente no config **usado** no deploy | `wrangler deployments view` |
| Ladder parado no tempo, API 200 | cron rodando sem D1 | `/health.ranked.d1` |
| `finish` → **413** | replay >4000 comandos (baralho travando/loop) | reproduza local com `npm run test:long` |
| `finish` → **400** "partida rejeitada" | divergência engine↔replay (versões diferentes) | comparar `package.json` do build vs worker |

**Regra deste projeto**: "deve ser Cloudflare" não é diagnóstico. Cada linha
acima tem um comando que responde sim/não.

## Rollback

- Migrations são **aditivas** (`0002` não altera nem dropa coluna de `0001`):
  reverter o Worker para o deployment anterior não quebra o banco. Nunca edite
  uma migration aplicada — adicione `0003_*.sql`.
- `wrangler rollback --config worker/wrangler.local.toml` cobre o Worker.
- Dados de Liga: `ranked_matches` é append-only com chave de idempotência, e
  `season_results` só é escrito pela liquidação → nenhuma migração precisa de
  "limpar" estado.

## Métricas que valem alguma coisa (2.1)

- `reports/meta-*.md` da CI (artefato `meta-ci`): winrate por arquétipo com
  IC 95%, matchups ≥80%/≤20%, turnos médios, cartas nunca usadas, vantagem de
  assento e de quem começa.
- `npm run ranked:sim -- --games 1000 --batch 50`: 1000 partidas bot×bot no
  engine real — o que mede a escada viva de verdade (o cron amostra expectativa
  Elo, não reproduz partidas).
