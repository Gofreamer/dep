# Changelog

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto usa versionamento semântico.

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
  (`e2e/`, 26 casos em Chromium, Firefox, mobile e tablet).
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
