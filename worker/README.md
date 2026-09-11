# JET TCG — servidor multiplayer (Cloudflare Worker + Durable Object)

Servidor de **salas privadas para exatamente 2 jogadores**. Sem contas, sem login,
sem matchmaking público, sem chat, sem espectadores. Um jogador cria a sala,
compartilha um código de 6 caracteres (ou um link de convite), o amigo entra,
os dois escolhem baralho, ficam prontos e jogam. O servidor é autoritativo:
toda regra roda aqui, o cliente só envia comandos.

```
worker/
├── src/
│   ├── index.ts      # rotas HTTP + upgrade de WebSocket + filtro de Origin
│   ├── room.ts       # Durable Object `RoomDO`: sockets ⇄ assentos, limites,
│   │                 #   persistência do lobby, alarm de TTL, entrada na sala
│   └── config.ts     # CLIENT_ORIGINS, CORS
├── wrangler.toml
└── tsconfig.json     # typecheck isolado (npm run typecheck:worker)
```

A regra do jogo **não** é duplicada aqui. `worker/src/room.ts` importa
`src/net/roomCore.ts` (máquina de sala: lobby, validação de baralho, revision,
idempotência, concessão, revanche) que por sua vez usa `src/engine/*` — o mesmo
`MatchEngine` do modo contra a IA. `src/net/*` é puro (sem DOM, sem
`localStorage`), por isso pode rodar no Worker e ser testado no Node.

## Rodar localmente

```bash
npm run worker:dev          # http://127.0.0.1:8787
```

Em outro terminal, o cliente apontando para ele:

```bash
echo "VITE_MULTIPLAYER_URL=http://127.0.0.1:8787" > .env
npm run dev
```

`.env` nunca é commitado (só `.env.example`, com placeholder vazio).

## Rotas

| Rota          | Método | Resultado                                                             |
| ------------- | ------ | --------------------------------------------------------------------- |
| `/health`     | GET    | `{"ok":true,"service":"jet-tcg-multiplayer","protocolVersion":1}`     |
| `/`           | GET    | página de informação (HTML estático, sem jogo)                        |
| `/room/new`   | WS     | aloca um código livre e faz o upgrade; o cliente envia `CREATE_ROOM`   |
| `/room/:CODE` | WS     | upgrade para a sala existente; o cliente envia `JOIN_ROOM`/`RECONNECT` |

Códigos fora do alfabeto (`3456789ABCDEFGHJKMNPQRSTUVWXY` — sem `0 1 2 I L O`,
para evitar ambiguidade ao ditar) são recusados no HTTP com `400`.

### Segurança no handshake

WebSocket **não** usa CORS: o controle real é o cabeçalho `Origin`.

- upgrade sem `Origin`, ou com origem fora da lista → **403**;
- `CLIENT_ORIGINS` (variável de ambiente, lista separada por vírgula) define as
  origens aceitas. Em dev, `http://localhost:5173`, `http://localhost:4173`,
  `http://127.0.0.1:5173` e `http://127.0.0.1:4173` já são aceitas;
- `CLIENT_ORIGINS='*'` desativa o filtro (não recomendado em produção);
- `ALLOW_INSECURE_ORIGIN=1` é a válvula de escape explícita para teste manual.

Dentro do socket, toda mensagem passa por `parseClientMessage` (JSON válido,
tipo conhecido, campos no formato certo), limitada a `MAX_MESSAGE_BYTES`
(64 KiB). JSON inválido → `bad_message`; grande demais → `message_too_large`.
Stack trace interno **nunca** vai para o cliente (só para o log do Worker), e
`seatToken` é mascarado em qualquer log.

## Protocolo (versão 1)

`src/net/protocol.ts` é a única fonte de tipos, compartilhada por Worker,
cliente e testes.

**Cliente → servidor:** `CREATE_ROOM`, `JOIN_ROOM`, `RECONNECT`, `SELECT_DECK`,
`READY`, `COMMAND` (`commandId` + `revision` + `Command` do engine), `CONCEDE`,
`REMATCH`, `PING`, `LEAVE`.

**Servidor → cliente:** `JOINED`, `LOBBY`, `MATCH_START`, `STATE`,
`COMMAND_REJECTED`, `MATCH_OVER`, `PEER_STATUS`, `ERROR`, `PONG`, `ROOM_CLOSED`.

### Autoridade e consistência

- `revision` monotônica por sala: começa em 1 no `MATCH_START` e sobe 1 por
  comando aplicado. Comando com `revision` diferente da atual é recusado com
  `stale_revision` e o cliente se ressincroniza com o próximo `STATE`.
- `commandId` (janela de deduplicação): reenvio do mesmo id é recusado com
  `duplicate` — a jogada não é aplicada duas vezes.
- O comando só é aceito se vier do assento dono dele (`command.player === seat`)
  e o `MatchEngine` valida a legalidade pela mesma `legalActions` do modo local.
  Baralhos são revalidados no servidor por `validateDeck` + registry; o cliente
  nunca é acreditado.
- O servidor é o dono do RNG: o seed fica no Worker e **nunca** é enviado.

### Informação escondida

`src/net/view.ts` monta a visão de cada jogador (`viewForPlayer`):

- mão e baralho do adversário chegam como `[]` + `hidden: { hand, deck }`
  (contagem apenas);
- `seed` e `rngState` vão zerados em toda visão;
- `CARD_DRAWN` do adversário perde o `defId` (senão daria para saber o que ele
  comprou);
- `CHOICE_REQUESTED` e `pending` só aparecem para o jogador que precisa decidir.

Nenhuma imagem trafega: o cliente resolve `cardId → CardDef → resolveCardArt()`
localmente. O Worker inclusive recusa persistir payload que contenha arte
binária/`data:` (`payloadContainsBinaryArt`).

### Sessão e reconexão

- `seatToken` (aleatório criptográfico) é enviado **uma única vez**, no `JOINED`
  da criação ou da primeira entrada, e guardado pelo cliente em
  `sessionStorage`. Só o código da sala **não** basta para reassumir um assento.
- `RECONNECT` exige o token; token errado → `bad_token`. Em reconexão o servidor
  responde `JOINED` com `seatToken: ''` (não reenvia o segredo).
- Queda durante a partida não encerra a sala: o adversário recebe
  `PEER_STATUS {connected:false}` ("Oponente desconectado") e a sala aguarda
  dentro da janela de reconexão.

### Ciclo de vida

`RoomCore.onTick()` decide, a partir do alarm do Durable Object:

| Situação                              | Limite (`DEFAULT_TTL`) |
| ------------------------------------- | ---------------------- |
| Lobby parado sem ninguém              | 30 min                 |
| Partida parada (ninguém age)          | 20 min                 |
| Janela de reconexão                   | 5 min                  |
| Vida máxima da sala                   | 6 h                    |

Passou do limite, a sala é encerrada e o alarm deixa de ser reagendado.

**Limitação conhecida e documentada:** a persistência guarda o **lobby**
(cadeiras, baralhos, prontos, tokens). Se o Durable Object for evacuado no meio
de uma partida, a sala volta ao lobby e os jogadores recomeçam a partida — não
há reconstrução de partida em andamento a partir do storage.

## Testes

```bash
npm run typecheck:worker    # tipos do Worker (tsconfig próprio)
npm test                    # tests/net-room.test.ts — 41 casos sobre RoomCore (Node, sem rede)
npm run test:worker         # sobe wrangler dev e roda tests/worker-live.test.ts
```

`npm run test:worker` é integração de verdade: sobe o `wrangler dev`
(workerd + Durable Object local), espera o `/health` e dirige **dois clientes
WebSocket reais** pelo fluxo completo — criação, entrada por código, sala cheia,
`room_not_found`, baralho inválido, `MATCH_START`, preparação, comando legal,
ilegal e do jogador errado, `stale_revision`, `commandId` duplicado, JSON
malformado, payload gigante, `PING`, desconexão + reconexão por token, token
errado, concessão, revanche e lobby. Também confere no nível HTTP o `/health`
sem CORS para origem não permitida, o `403` do upgrade sem `Origin` válido e o
`400` de código malformado. Sem `JET_WORKER_URL` o arquivo é pulado.

O fluxo completo em **dois navegadores** está em `e2e/multiplayer.spec.ts`
(Playwright, dois contextos independentes).

## Deploy

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Variáveis:

| Variável             | Exemplo                                              | Papel                                   |
| -------------------- | ---------------------------------------------------- | --------------------------------------- |
| `CLIENT_ORIGINS`     | `https://jet-tcg.pages.dev,https://app.exemplo.com`  | origens aceitas no handshake            |
| `ALLOW_INSECURE_ORIGIN` | `1`                                                 | só para teste; desativa o filtro        |

Depois, aponte o frontend para o Worker:

```bash
VITE_MULTIPLAYER_URL=https://jet-tcg-multiplayer.<sua-subdominio>.workers.dev npm run build
```

Sem `VITE_MULTIPLAYER_URL` o cliente mostra **"Servidor multiplayer não
configurado."** e o modo contra a IA continua funcionando normalmente — o
multiplayer é adicional, nunca requisito.
