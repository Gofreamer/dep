# JET TCG — relatório de lançamento v1.0.0

Data: **2026-09-11** · Branch: **`arena/01a08e88-dep`** · Base: `1451bda`

Este documento registra o que foi feito, o que foi medido e o que **não** pôde
ser feito neste ambiente. Nada aqui é aspiracional: cada número abaixo saiu de
um comando executado no repositório.

---

## 1. Escopo entregue

| Item | Estado |
| --- | --- |
| Jogo completo contra a IA | entregue |
| Tutorial interativo | entregue |
| Construtor de baralhos | entregue |
| Coleção / histórico / ajustes | entregue |
| Artes oficiais | entregues (18 BASE + 10 especiais, snapshot versionado) |
| UX desktop + mobile | entregue (verificado em 4 viewports; E2E de navegador **não executado aqui** — ver §9) |
| Multiplayer privado 1×1 | entregue (servidor + cliente) |
| Engine autoritativa no servidor | entregue |
| E2E em navegador real | **escrito e coletado; execução bloqueada neste sandbox** (§9) |
| CI completa | entregue (`.github/workflows/ci.yml`, 4 jobs) |
| Dependências auditadas | 0 vulnerabilidades |
| Build de produção | OK |
| Docs para rodar/deployar | entregues (`README.md`, `worker/README.md`) |
| Zero dependência de runtime de HUD-RPG / Jet Tactics / Fórum / Firebase | confirmado (§8) |

---

## 2. Commits

```
1451bda  (base, origin/main)
4bb48d0  fix: close release blockers and dependency issues
64683ab  feat: add private multiplayer backend (Cloudflare Worker + Durable Object)
b14581a  feat: polish JET TCG game experience + UI test coverage that actually runs
dd3aea4  test: integração real do Worker multiplayer + bug de entrada em sala inexistente
<sha>    docs+e2e: E2E Playwright, CI completa, worker/README, changelog, v1.0.0
```

O `<sha>` do último commit é o SHA final do branch — conferir com
`git log --oneline -1`.

---

## 3. Verificações executadas

Ambiente: Node **v22.22.3**, npm **10.9.8**, vitest **5.0.0**, vite **8.3.0**.

### 3.1 Typecheck

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`, inclui `src`, `tests`, `e2e`, `playwright.config.ts`) | **0 erros** |
| `npm run typecheck:worker` (`tsc -p worker/tsconfig.json --noEmit`) | **0 erros** |

### 3.2 Testes (vitest)

```
Test Files  17 passed | 1 skipped (18)
     Tests  334 passed | 15 skipped (349)
  Duration  10.76s
```

- **334 passed**
- **15 skipped**: 14 de `tests/worker-live.test.ts` (só rodam com
  `JET_WORKER_URL`, ver §3.4) + 1 skip pré-existente do repositório
  (`tests/jet-matches.test.ts` quando `JET_LONG_TESTS` não está definido)
- **0 failed**

Cobertura por arquivo: engine (38), invariáveis (28), cartas JET (23),
edições (32), artes (36), agentes (12), status (12), integração (10),
persistência (11), meta (8), fluxo (4), **UI em jsdom (18)**,
**ErrorBoundary (5)**, **protocolo/sala multiplayer (41)**.

### 3.3 Bateria longa de partidas

```
✓ Bateria longa (JET_LONG_TESTS=1): 9×3×5 = 135 partidas
Test Files  1 passed (1)
     Tests  36 passed (36)
```

**135 partidas IA×IA** concluídas, sem travamento e sem jogada ilegal.

### 3.4 Integração real do Worker multiplayer

```
[worker-test] pronto: {"ok":true,"service":"jet-tcg-multiplayer","protocolVersion":1}
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

`npm run test:worker` sobe o **`wrangler dev` de verdade** (workerd + Durable
Object local) e dirige **dois clientes WebSocket reais** (`tests/worker-live.test.ts`).
Não há mock de socket nem de sala. Os 14 casos:

1. `/health` responde e não aplica CORS para origem não permitida;
2. upgrade recusado com **403** sem `Origin` e com origem fora da allowlist;
3. criar sala → código de 6 caracteres no alfabeto anti-ambiguidade, assento 0,
   token > 16 caracteres, `protocolVersion: 1`;
4. jogador 2 entra pelo código; terceiro recebe `room_full`; `LOBBY` nunca
   carrega o token;
5. sala inexistente → `room_not_found` com o texto de jogador; código com
   caracteres fora do alfabeto → **400** antes do upgrade;
6. baralho inválido recusado pelo servidor; dois prontos → `MATCH_START` para os
   dois, com `seed`/`rngState` zerados, mão e baralho do adversário vazios com
   apenas contagem, e nenhuma URL de imagem no payload;
7. preparação dos dois lados leva à fase principal;
8. comando do jogador errado e comando ilegal recusados; comando legal aplicado
   com `revision + 1`;
9. `revision` desatualizada → `stale_revision`; `commandId` repetido →
   `duplicate` (não aplica duas vezes);
10. JSON malformado → `bad_message`; payload de ~120 KB → `message_too_large`;
    sala continua viva (`PING` → `PONG`);
11. desconexão preserva assento, o adversário recebe `PEER_STATUS
    {connected:false}` e a reconexão com token restaura a visão (token **não** é
    reenviado; token errado → `bad_token`);
12. concessão encerra a partida com vencedor decidido pelo servidor, igual nos
    dois clientes;
13. revanche exige os dois e cria partida nova (fase `setup`, `winner: null`,
    `turn: 0`);
14. lobby informa os dois jogadores com baralho e pronto, sem token.

### 3.5 E2E de navegador (Playwright)

```
Total: 26 tests in 4 files
```

Projetos configurados: **desktop-chromium** (1440×900), **desktop-firefox**
(1366×768), **mobile-touch** (390×844, `hasTouch`, `isMobile`), **tablet**
(768×1024, `hasTouch`).

| Arquivo | O que cobre |
| --- | --- |
| `e2e/smoke.spec.ts` | carregamento sem erro de console, 7 entradas do menu em PT-BR, partida até o board, tutorial, coleção/histórico/ajustes |
| `e2e/flow.spec.ts` | inspeção de carta + Escape, mão oculta do adversário, encerrar turno, pausa (continuar/reiniciar/menu), coleção com filtro, construtor (adicionar/remover/validar/salvar), persistência de baralho e de ajuste entre recarregamentos, multiplayer sem servidor |
| `e2e/responsive.spec.ts` | sem transbordo horizontal, área de toque ≥ 40 px, board cabe no celular |
| `e2e/multiplayer.spec.ts` | **dois contextos de navegador**: criar sala → código → entrar → baralhos → prontos → partida, mão do adversário invisível, nenhuma `<img src="data:">`, preparação, concessão, revanche, convite por link `?room=` |

**Executados na CI em navegador real** (run `34572311434`, commit `022c6be`):

| Job | Resultado |
| --- | --- |
| `E2E de navegador` | **24 passed · 2 skipped** (47.3 s) — Chromium, Firefox, iPhone 13 (WebKit), tablet |
| `E2E multiplayer (2 navegadores + Worker)` | **2 passed** (10.4 s) |

Os 2 skipped do primeiro job são justamente os testes multiplayer, que rodam no
job dedicado com o Worker de pé. Total executado em navegador: **26 testes**.

No sandbox de desenvolvimento não há navegador instalável (ver §9), então esses
números vêm da CI — que é onde eles devem rodar mesmo. A primeira execução real
encontrou 4 defeitos que nenhum teste anterior pegava; estão na §5.

### 3.6 Build de produção

```
vite v8.3.0 building client environment for production...
✓ 71 modules transformed.
dist/index.html                   0.72 kB │ gzip:   0.43 kB
dist/assets/index-Cdrxtf8D.css   34.91 kB │ gzip:   7.91 kB
dist/assets/index-BdI_Afbe.js   385.01 kB │ gzip: 108.54 kB
```

**JS 385.01 kB (108.54 kB gzip)** · **CSS 34.91 kB (7.91 kB gzip)**.
Baseline do branch base era 356.43 kB de JS; o crescimento vem do cliente
multiplayer, das telas online e da camada de som.

### 3.7 Auditoria de dependências

```
found 0 vulnerabilities
```

**0 vulnerabilidades** em 147 pacotes. O baseline em `1451bda` tinha 5
vulnerabilidades dev-only (`vite` high ×3, `vitest` critical GHSA-5xrq-8626-4rwp
CVSS 9.8 + GHSA-82fw-gwwq-j7x9, `esbuild`/`@vitest/mocker`/`vite-node`
moderate). Foram eliminadas por atualização deliberada de devDependencies
(Vite 8, Vitest 5, plugin React 6, TypeScript 5.9) com regeneração do lockfile —
não por `npm audit fix --force`.

**Nenhuma vulnerabilidade residual**, nem dev-only.

Dependências novas, todas **dev-only** (runtime do app continua sem dependência
nova além de React/Zustand já presentes):

| Pacote | Motivo |
| --- | --- |
| `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom` | testar a UI real em DOM (antes só havia teste de engine) |
| `@playwright/test` | E2E em navegador |
| `wrangler` | rodar/deployar o Worker |
| `ws` + `@types/ws` | cliente WebSocket de teste com cabeçalho `Origin` (a API global do Node não permite) |
| `@cloudflare/workers-types` | tipos do Worker |

---

## 4. Multiplayer: como funciona

**Fluxo implementado:** criar sala → código de 6 caracteres e link de convite →
os dois escolhem baralho → os dois ficam prontos → partida → resultado →
revanche. Sem contas, sem login, sem matchmaking público, sem chat, sem
espectadores, sem torneio, sem ranking, sem loja.

**Código da sala:** 6 caracteres do alfabeto `3456789ABCDEFGHJKMNPQRSTUVWXY`
(sem `0 1 2 I L O`, para não haver ambiguidade ao ditar). Alocado pelo Worker
com verificação de colisão por `/probe`. Compartilhável por texto ou por link
`…/?room=CODE`, que já preenche o campo.

**Autoridade:** o cliente envia apenas `COMMAND` com `commandId` + `revision`. O
Worker valida (`parseClientMessage`, assento dono, baralho revalidado), aplica
ao **mesmo** `MatchEngine` do modo local, sobe a `revision` monotônica e devolve
`viewForPlayer`. Seed e RNG ficam no servidor.

**Mão e baralho ocultos:** `src/net/view.ts` devolve `hand: []` e `deck: []` do
adversário com `hidden: {hand, deck}` apenas como contagem; `seed`/`rngState`
zerados; `defId` removido do `CARD_DRAWN` alheio; `pending` e
`CHOICE_REQUESTED` só para quem decide. Verificado em
`tests/net-room.test.ts` (41 casos) e na integração real (§3.4, caso 6).

**Reconexão:** `seatToken` aleatório entregue uma única vez e guardado em
`sessionStorage` — **só o código da sala não reassume um assento**. Queda no
meio da partida não encerra a sala: o adversário vê "Oponente desconectado" e a
sala espera dentro da janela de 5 min; no cliente aparecem "Reconectando…" e
"Reconectado.". Token errado → `bad_token`.

**Sem servidor configurado:** o menu mostra **"Servidor multiplayer não
configurado."** e o modo contra a IA segue funcionando normalmente — coberto por
teste em jsdom e por `e2e/flow.spec.ts`.

---

## 5. Bugs corrigidos

Todos objetivos (contradiziam regra, texto de carta, invariante ou o código
declarado), nenhum rebalanceamento subjetivo:

1. **`rawBasePhotoOf`** (`src/integrations/jet/cardArt.ts`) — `player?.photo ??
   photoUrl ?? image` aceitava string vazia (`photo: ""`), derrubando arte
   oficial válida para o fallback procedural. Agora percorre os três campos
   ignorando ausentes e vazios-após-trim.
2. **Baralho do oponente** (`src/ui/screens/DeckSelectScreen.tsx`) — padrão
   `'deck-controle-tatico'`, id que só existe em `src/data/fixtures/nexo/decks.ts`
   (nunca registrado em produção). O `<select>` renderizava sem opção marcada e
   `startMatch` caía num fallback silencioso para `JET_STARTER_DECKS[0]`. Agora o
   padrão é um baralho realmente salvo.
3. **`vitest` não coletava `*.test.tsx`** — `vite.config.ts` tinha
   `include: ['tests/**/*.test.ts']`, então
   `tests/jet-error-boundary.test.tsx` **nunca foi executado**. Dois de seus
   casos chamavam `setState` em instância não montada (no-op no React 18), ou
   seja, não verificavam nada. Padrão corrigido e arquivo reescrito com render
   real (5 testes).
4. **Entrar em sala inexistente criava a sala** — `JOIN_ROOM` com código bem
   formado porém nunca criado abria uma sala fantasma em vez de responder
   `room_not_found`. Corrigido em `worker/src/room.ts`.
5. **`FXLayer` só lia cues locais** — jogar online não produzia feedback visual.
   Tradução evento→cue extraída para `src/game/cues.ts`; a camada atende os dois
   modos sem duplicar regra.
6. **Clique em carta não posicionável na preparação não fazia nada** — agora abre
   a inspeção.
7. **`tamnhos` → `tamanhos`** (campo de configuração) e `engines.node` alinhado
   ao mínimo exigido pelo Vite 8 (`>=20.19`).

Encontrados **somente** pela execução do E2E em navegador real (nenhum teste
anterior, em jsdom ou de engine, os detectava):

8. **Escape abria o menu de pausa junto com a inspeção.** `InspectModal` e
   `PauseOverlay` ouviam `keydown` no `window`; fechar a inspeção com Escape
   também ligava a pausa e deixava um `.modal-backdrop` cobrindo a partida,
   bloqueando qualquer clique seguinte. Corrigido com listener em fase de
   *capture* + `stopPropagation`, registrado só com o modal aberto. Regressão
   coberta em `tests/ui-app.test.tsx` — verificado que a asserção **falha** sem o
   fix.
9. **Cartas da mão cobriam o dock de ações.** `.hand` é absoluta com
   `z-index: 20` e `.my-bar` só ganhava empilhamento dentro da media query
   mobile; em desktop as cartas interceptavam o clique em "Pronto"/"Encerrar
   Turno" (reproduzido em Firefox 1366×768). Corrigido subindo apenas o
   `.command-dock` — subir a `.my-bar` inteira causava o efeito oposto, cobrindo
   as cartas.
10. **As primeiras cartas da mão ficavam inalcançáveis** quando a mão
    transbordava: `justify-content: center` com `overflow-x: auto` faz o
    conteúdo vazar pelos dois lados e o início fica fora da área rolável.
    Corrigido com `justify-content: safe center`.
11. **`deck-select` no E2E multiplayer** exigia escolher o Agente Base antes do
    "Pronto" (mesma regra do modo local).

Dois **verde-falsos da própria CI**, ambos corrigidos:

12. `npm run test:e2e 2>&1 | tee` sem `pipefail` devolvia o status do `tee`: o
    job dava `success` com 2 testes falhando. Corrigido com `shell: bash` +
    `set -o pipefail`.
13. O job de E2E multiplayer reportava `2 skipped` porque `VITE_MULTIPLAYER_URL`
    (variável de build) não estava no ambiente do teste — o job "passava" sem
    executar nada. Corrigido exportando as duas variáveis e adicionando um passo
    que falha se o log não mostrar nenhum teste `passed`.

---

## 6. Artes

Snapshot versionado em `src/data/jet/artSnapshot.ts`, proveniência registrada:
`Gofreamer/cartinhas23 @ 580c8ee03f9c59d7356a01fb8ae5f50a8423ff03`, arquivo
`seed-cards-import.json`, captura em 2026-09-11.

- **18 entradas BASE** — uma por identidade de agente (todas com `playerKey`);
- **10 entradas de edição especial** (todas com `defId`);
- **28 URLs distintas**.

Verificado por `tests/jet-card-art.test.ts` ("18 BASE + 10 especiais, 28 URLs
distintas"), que faz parte dos 334 testes aprovados.

Ordem do resolver preservada: **edição especial → BASE por `identityId` →
fallback procedural** (testado: `resolveArtWithIndex(index, 'agent-jenny',
'BASE')` → `{kind:'procedural'}` quando não há BASE). Nenhuma URL entra em
`MatchState`; nenhum blob/base64 entra em save; o Worker recusa persistir
payload com arte binária.

---

## 7. O que o CI executa

`.github/workflows/ci.yml`, 4 jobs:

| Job | Passos |
| --- | --- |
| `verify` | `npm ci`, `npm audit --audit-level=moderate`, typecheck, typecheck do Worker, vitest, bateria de 135 partidas, build, upload de `dist` |
| `worker-integration` | `npm run test:worker` (wrangler dev + 2 clientes WebSocket) |
| `e2e` | `npx playwright install --with-deps chromium firefox`, `npm run test:e2e` (desktop + mobile + tablet), upload de relatório em falha |
| `e2e-multiplayer` | sobe o Worker local, build com `VITE_MULTIPLAYER_URL`, `playwright test multiplayer.spec.ts` com dois contextos |

---

## 8. Independência de runtime

Nenhuma consulta em runtime a HUD-RPG, Jet Tactics, Fórum ou Firebase:

- o conteúdo vem do snapshot commitado (`src/data/jet/*`); `seed-cards-import.json`
  é referenciado apenas em comentários, tipos e no script de importação — **não**
  é carregado em runtime (verificado por busca em `src/`);
- a integração Jet Tactics (`src/integrations/jet/`) é camada de conversão e
  resolução de arte, sem fetch;
- nenhum cliente Firebase, nenhuma API de fórum, nenhum código de HUD-RPG.

---

## 9. Limitações conhecidas e itens externos pendentes

### Bloqueado neste ambiente (não é pendência de código)

1. **E2E de navegador não rodam no sandbox de desenvolvimento** — só na CI, e
   foi lá que rodaram (§3.5). `npx playwright install chromium` falha aqui
   (download bloqueado: apenas `github.com` e `registry.npmjs.org` são
   alcançáveis), não existe Chrome/Firefox no sistema e as bibliotecas mínimas
   de um Chromium (`libnss3`, `libgbm`, `libasound`, `libpango`) estão ausentes,
   com `apt` negado. **Itens concluídos na CI:** os 26 testes passaram em
   Chromium, Firefox, WebKit (iPhone 13) e tablet, incluindo o fluxo multiplayer
   completo em dois navegadores contra o Worker. Pendência real restante: os
   logs de job e artefatos do Actions ficam em blob storage inalcançável daqui,
   então o diagnóstico foi feito pelas anotações da API e por um resumo que a
   própria CI publica no PR.
2. **Deploy do Worker e do frontend.** Não há credencial Cloudflare neste
   ambiente, então não houve `wrangler deploy` nem publicação no Pages — e, por
   consequência, não existe URL de preview pública para citar. O código, o
   `wrangler.toml` e o passo a passo estão prontos (`worker/README.md`).

### Limitação de projeto (documentada, não é defeito)

3. A persistência do Durable Object guarda o **lobby** (cadeiras, baralhos,
   prontos, tokens). Se a DO for evacuada **no meio de uma partida**, a sala
   volta ao lobby e a partida recomeça. Não há reconstrução de partida em
   andamento a partir do storage.

### O que ainda pode aparecer em uso real

4. Os testes de UI rodam em **jsdom**, que não implementa layout, toque nem
   `matchMedia`. Quebras puramente visuais (sobreposição, corte, contraste real)
   só aparecem no E2E de navegador, que depende do item 1.
5. O E2E multiplayer depende de o Worker local estar de pé; sem ele o job é
   pulado de propósito. Em CI ele é iniciado pelo próprio job.

Nada acima impede o jogo local contra a IA, que é o caminho principal e está
inteiramente coberto por testes executados aqui.
