# JET TCG 2.0 — Liga Ranqueada (vs Bots)

A Liga Ranqueada é **humano vs bot**, servidor-autoritativo. Não existe
matchmaking público entre humanos: multiplayer privado continua humano vs
humano, sem rank e sem login.

## Ranks

Hierarquia fixa (da mais baixa para a mais alta):

```
FERRO < BRONZE < PRATA < OURO < PLATINA < DIAMANTE < MESTRE < CAMPEÃO
```

- **CAMPEÃO** é o rank normal máximo (piso 2000 de rating).
- **REI DA LIGA** NÃO é um rank ganho por pontos: é o título dos **CAMPEÕES
  que estão no Top 10 global**. Transições dinâmicas (subir exige vitória,
  cair exige derrota) — ver `src/ranked/ranks.ts`.

## Rating (Elo)

- Rating inicial: **1000** (Ferro).
- Fator K por faixa (ratings altos mudam mais devagar).
- **Delta mínimo de 1**: vencer SEMPRE move — nunca fica impossível
  ultrapassar o topo.
- O servidor aplica cada `rankedMatchId` **exatamente uma vez** (idempotente).

## Bots

- **StellaPrime** — aggro, #1 inicial (2460), dificuldade 90% (elite).
- **Luna underdog** — control, #2 inicial (2390), dificuldade 86% (hard).
- 22 bots no total (`src/ranked/bots.ts`), cada um com UM arquétipo fixo:
  o bot **escolhe o deck antes de ver qualquer informação privada** — nunca
  há contra-pick.
- **Nenhum bot tem posição travada.** Um humano (ou outro bot) pode
  ultrapassar StellaPrime e tomar o #1.

## Anti-trapaça (o cliente nunca decide o resultado)

1. O cliente envia apenas o **baralho** (validado server-side) e a **sequência
   de comandos do humano** (incl. escolhas mid-effect).
2. O servidor **repete a partida** no MatchEngine real (`src/ranked/replay.ts`),
   gerando os comandos do bot ele mesmo (IA determinística).
3. Qualquer comando ilegal → submissão **rejeitada** (`ReplayError`).
4. O vencedor é lido do estado final do engine — nunca do payload.

## Contas e sessões (D1)

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`.
- Senha **nunca em claro**: PBKDF2-SHA256 (120k iterações) + salt aleatório.
- Token de sessão aleatório (256 bits) com expiração (30 dias).
- **Rate limit** por IP+rota (30/min) nos endpoints de auth.
- Contas são exigidas **apenas** para Ranqueada/perfil/ladder. Multiplayer
  privado e casual vs IA continuam sem login.

## Rotas ranqueadas

| Rota | Auth | Descrição |
|---|---|---|
| `GET /ranked/ladder?limit=100` | não | Ranking global (Top 100, bots inclusos) |
| `GET /ranked/profile` | sim | Perfil/posição do usuário |
| `POST /ranked/start` | sim | Cria ticket assinado + escolhe bot (seed, assento) |
| `POST /ranked/finish` | sim | Replay + aplicação idempotente de rating |

## Seasons & janela de reconexão

- **Season 1** (`src/ranked/seasons.ts`): janela de 90 dias + **7 dias de graça**
  (resultados enviados na graça ainda contam).
- **Janela de reconexão**: o ticket do `start` é assinado (HMAC) e vale por
  2h — se o cliente cair no meio da partida, pode reconectar e submeter a
  sequência de comandos dentro dessa janela; o servidor revalida tudo.

## Bot ladder simulation (liderança viva)

```bash
npm run ranked:sim -- --games 100 --batch 20
```

Simula lotes de partidas bot×bot (perfis individuais) e aplica o Elo no ladder.
StellaPrime começa #1 mas não é fixo — se perder repetidamente, cai.

## Deploy / D1 (documentação de produção)

```bash
npx wrangler d1 create jet-tcg-db                       # cria o banco
npx wrangler d1 execute jet-tcg-db --file worker/migrations/0001_ranked.sql
npx wrangler secret put JET_RANKED_SECRET               # segredo dos tickets
# edite worker/wrangler.toml: database_id e CLIENT_ORIGINS
npx wrangler deploy --config worker/wrangler.toml
```

Variáveis de ambiente (`worker/wrangler.toml`):

| Var | Obrigatória | Uso |
|---|---|---|
| `CLIENT_ORIGINS` | sim (prod) | origens permitidas (WS/CORS) |
| `JET_DB` (binding D1) | sim (ranked) | contas/sessões/ladder |
| `JET_RANKED_SECRET` | sim (ranked) | assinatura dos tickets |
| `ALLOW_INSECURE_ORIGIN=1` | não | só testes locais |

Frontend: `VITE_RANKED_API_URL` aponta para o Worker (mesma convenção de
`VITE_MULTIPLAYER_URL`). Sem ela, a Liga mostra "não configurada" e o resto do
jogo continua funcionando.

## Testes

- `tests/ranked.test.ts` — rating, ranks, bots, ladder, idempotência, Top 10,
  "humano ultrapassa StellaPrime", seasons.
- `tests/ranked-replay.test.ts` — replay reproduz o vencedor, rejeita comandos
  adulterados/incompletos, valida baralho.
- `tests/ranked-api.test.ts` — handlers HTTP do Worker (auth + start/finish +
  ladder) com `MemoryRankedRepo` (sem D1 real).
- `e2e/ranked.spec.ts` — fluxo E2E real (registro → ladder → partida → rating).
