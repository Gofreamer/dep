# dep — NEXO TCG

Jogo de cartas colecionáveis (TCG) jogável no navegador: **Player vs IA**, inspirado no ritmo/estrutura de TCGs clássicos, mas 100% original (tema NEXO). Todo o jogo em **PT-BR**.

## Como rodar

```bash
npm install
npm run dev      # abre em http://localhost:5173
npm run build    # build de produção (tsc -b && vite build)
npm test         # suíte de testes (vitest)
```

## Estrutura

```
src/
  engine/          # Núcleo genérico e autoritativo (sem UI, sem strings de tema)
    types.ts       # Commands, MatchState, PendingChoice, CardDef/StatusDef…
    rng.ts         # RNG determinístico centralizado (semente)
    effects.ts     # Motor de efeitos data-driven
    triggers.ts    # Gatilhos por evento
    statuses.ts    # Status com tokens
    registry.ts    # Registro de cartas/status/facções/recursos
    ai/            # IA heurística (fácil/normal/difícil)
  data/            # Conteúdo NEXO (cartas, decks starter, terminologia, gatilhos de tutorial)
  game/            # MatchController — ponte engine ⇄ UI (comandos, IA, tutorial)
  persistence/     # Interface de persistência + adapter localStorage
  ui/              # React: telas (título, seleção de deck, builder, partida…) e componentes
tests/             # Testes do motor + teste de fluxo completo (humano vs IA)
```

## Regras implementadas

- Setup com mulligan automático, escolha de ativo/reserva, jogador inicial aleatório
- Vitória por **pontos de vitória** (padrão: 4) + derrotas alternativas (sem substituto para o ativo, deck-out)
- Custo de recuo em recursos genéricos, fraqueza ×2, resistência −30, 1 slot de campo, 2 slots de equipamento
- Evoluções (upgrade), efeitos/gatilhos/status 100% data-driven, alvos declarados em dados
- IA com 3 dificuldades heurísticas (não aleatória)
- Tutorial interativo passo-a-passo, painel de debug (modo dev), rematch instantânea
- Log de eventos, RNG semeado (partidas reproduzíveis via seed)

## Conteúdo

103 cartas originais — 43 personagens, 12 recursos, 30 ações, 12 equipamentos, 6 campos — em 6 facções (Solar, Maré, Flora, Volt, Umbra, Neutro). 3 decks starter (Fúria Solar, Ascensão, Controle Tático) + 2 decks de tutorial.

O motor fala apenas conceitos genéricos (Character/Resource/Upgrade/Action/Equipment/Field/Status/Faction/VictoryPoint); todos os nomes exibidos vêm da configuração de terminologia — trocar de tema (ex.: JET) exige apenas dados novos.
