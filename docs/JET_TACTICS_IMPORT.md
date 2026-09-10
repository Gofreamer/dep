# JET TCG — Importação do Jet Tactics

Este documento explica as três camadas de identidade do produto e como os
dados fluem do projeto de referência para o jogo de cartas.

## As três camadas

| Camada | Projeto | Papel |
|---|---|---|
| **Jet Cards** | Jet Tactics (Jet Cards service) | **Identidade oficial** — quem existe: agentes, equipes, edições, artes |
| **Jet Tactics** | `RocksXB/jet-tactics` | **Identidade competitiva** — como cada agente joga: passiva, Skill, Signature, role, arquétipo |
| **JET TCG** | este repositório | **Adaptação TCG** — números, custos, efeitos e balanceamento para o jogo de cartas |

Regras fundamentais:

1. **O JET TCG não inventa agentes, equipes ou edições.** Tudo que entra no
   jogo vem do snapshot normalizado da fonte (`src/data/jet/snapshot.ts`).
2. **Não tradução literal de números.** `+2 Influence` no Jet Tactics NÃO vira
   `+2 de dano`. A identidade do papel é preservada (ver
   `docs/TCG_BALANCE_GUIDE.md`).
3. **Proveniência obrigatória.** Toda definição importada registra
   `sourceRepository`, `sourceType`, `sourceId` e `sourceEdition` — é possível
   descobrir de onde qualquer carta veio.

## Arquitetura da integração (`src/integrations/jet/`)

```
Jet Tactics (upstream, somente leitura)
   │  captura manual/assistida — NUNCA import em runtime
   ▼
scripts/import-jet-tactics.ts        raw/*.json → snapshot normalizado
   ▼
src/data/jet/snapshot.ts             JetSnapshot: agents, kits, teams, editions
   ▼
src/data/jet/agentProfiles.ts        PERFIS TCG curados (a tradução criativa
   │                                  de passiva/skill/signature → mecânicas)
   ▼
src/integrations/jet/converter.ts    (identidade + kit + perfil) → CharacterDef
src/integrations/jet/importer.ts     valida, registra no registry, separa pendentes
   ▼
engine (genérica)                    Agente = CHARACTER; Energia JET = RESOURCE…
```

- **`types.ts`** — contratos: `JetAgentIdentity` (quem o agente é),
  `JetAgentKit` (como joga no Jet Tactics), `JetEditionDef`, `JetTeamDef`,
  `JetProvenance`.
- **`normalize.ts`** — tolerante e defensivo: campos ausentes continuam
  ausentes; nada é preenchido com suposição.
- **`converter.ts`** — montagem mecânica do `CharacterDef` (identityId,
  edition, artRef oficial, holo cosmético, fraqueza/resistência, Suprema
  opcional). A criação criativa vive em dados, não aqui.
- **`importer.ts`** — única porta de entrada no registry. Times oficiais
  viram facções; edições com perfil curado viram cartas jogáveis; edições
  **sem** perfil ficam **`TCG_PROFILE_PENDING`** — aparecem no catálogo como
  "aguardando adaptação" e NÃO são jogáveis (política escolhida: não usar
  perfil BASE emprestado, para nunca falsificar um sidegrade).

## Como importar o roster

```bash
# 1. Capture os registros reais do repositório de referência:
#      docs/CARD_SOURCE_OF_TRUTH.md, js/services/jet-cards.js,
#      js/game/agents.js, js/game/curated-agents-1..6.js,
#      js/game/editions.js, js/game/power.js, docs/CURATED_ROSTER_v0.1.md
# 2. Salve em src/data/jet/raw/ como JSON:
#      agents.json  kits.json  editions.json  teams.json
npx tsx scripts/import-jet-tactics.ts [<sha-do-commit>]
# 3. Cure os perfis TCG: src/data/jet/agentProfiles.ts (um por edição)
# 4. Rode os testes: npx vitest run tests/jet-integration.test.ts
```

## Conceitos críticos

### `identityId` vs `id` de carta

`agent-jenny` é a **identidade** (a pessoa/agente). `agent-jenny-base` e
`agent-jenny-mvp` são **cartas** — variantes da mesma identidade. Usos:
limite de cópias por identidade (`maxCopiesPerIdentity`), coleção agrupada,
estatísticas, variantes futuras.

### Edição ≠ Evolução

`BASE / MVP / CHAMPION / FINALS / ICON` são versões colecionáveis (side
grades). **Nunca** viram estágios de evolução em campo. Transformação real em
batalha (Base → Forma → Despertar) é declarada explicitamente em dados
(`stage` + `upgradesTo`) e exige carta de Evolução real (ou efeito explícito).
O importador rejeita qualquer carta com `edition` e `stage > 0`.

### Suprema

Estrutura genérica opcional (`CharacterDef.ultimate`): condição de ativação +
custo + efeitos + once-per-match, 100% data-driven. Só é marcada como Suprema
quando a fonte oficial indica isso — Skill e Signature NÃO são Supremas por
padrão.

### Expansão de Domínio

Subtipo de FIELD (`subtype: 'DOMAIN'`) com `override` de campo de batalha
(bloquear trocas, modificar custos/dano, duração). Só é criada para agentes
com informação oficial suficiente. Nenhum FIELD genérico é promovido a
Domínio sem dados.

## Privacidade e segurança

- Nenhuma credencial/configuração Firebase/token do Jet Tactics é copiada.
- URLs de arte públicas (`imageUrl` oficial) viram `artRef` com fallback
  visual; nada autenticado é embutido no código.
- O JET TCG funciona 100% offline; uma futura sincronização online ficaria em
  um adaptador próprio, separado da engine (interface de persistência já
  abstrai o backend).
