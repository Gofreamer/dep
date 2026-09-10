# RELATÓRIO FINAL — NEXO → JET TCG (Parte 44)

Protótipo NEXO (PR #1) convertido no TCG **JET**, com roster oficial importado
da fonte `RocksXB/jet-tactics.` (repo real com ponto final, commit
`769196ea55`). Nada de agente/edição/equipe foi inventado: todo conteúdo de
carta deriva da captura auditável em `src/data/jet/raw/` + snapshot
normalizado + perfis curados com proveniência por carta.

---

## 1. Branch

`arena/01a08c23-dep` (a branch única desta sessão; PR aberto dela).

## 2. Commits (na ordem)

| Commit | Conteúdo |
|---|---|
| `ca51b0c` | Núcleo do engine TCG genérico (comandos, efeitos, alvos, statuses, upgrades, RNG semeado) |
| `46ad733` | Conteúdo NEXO + IA heurística + 38 testes de engine |
| `16daa06` | Camada de UI completa (telas, tema, debug dev-only, integração controller) |
| `5ef3b56` | README |
| `8a18fa6` | Invariantes TCG + conservação de instâncias |
| `ddf06cb` | Modelo de importação Jet Tactics + estrutura do data pack JET |
| `150a1d0` | Rebrand NEXO → JET na UI/docs |
| `c1a8308` | **Import do roster oficial, perfis curados, starter decks + correções de engine** |

## 3. Link do PR

**https://github.com/Gofreamer/dep/pull/1** — `main` ← `arena/01a08c23-dep`.
Sem merge automático; pronto para revisão.

## 4. Verificação

- **`tsc --noEmit`**: 0 erros.
- **`vitest run`**: **93/93** em 5 arquivos (engine 38, invariants 28, flow 4,
  jet-integration 13, jet-flow 10).
- **`npm run build`**: ok — `344.37 kB` / gzip `99.61 kB`.
- **Lint**: não configurado no repositório (nada a rodar).

## 5. Contagem de testes

93 testes automatizados, incluindo: partidas **IA×IA completas** com os 3
starter decks JET (3 pareamentos + 3 seeds, terminam sempre), conservação de
instâncias (zero carta fantasma), `legalActions ≡ dispatch` (nos dois
sentidos), validação de baralho (sem starter, 5 cópias, abaixo do mínimo),
SetupConfig honrado (mão 7, reserva no setup), variantes de edição na mesma
identidade, e o pipeline do importador (18/5/8/10) contra o snapshot real.

## 6. Agentes importados — 18

Todos com kit final da fonte (`curated-agents-6`, "Passe de Identidade
Tática v2") e carta BASE jogável:

| Equipe | Agentes |
|---|---|
| KOF 12 | Jenny (Suporte), Xixim (Breaker), Ran Yuki (Duelista), Shirakami Niku (Bastião) |
| Asgard | Alice Westland (Suporte), Tarruh (Guardião), Tayná Lannister Müller (Controladora) |
| Morning Star | Henry (Guardião), Mik Kashnov (Conector), Ryan Smith (Comandante), Saki (Breaker) |
| Bastard Gran Tubarões XYZ | Kaio (Breaker), Ruby (Duelista) |
| Rainbow Six | Wei Fang (Interdictor), Wei Wang (Controlador) |
| Salvatore | Hashika Gloves (Duelista) |
| Platinum | Baek Seo-jin (Controlador) |
| Weigon | Olivia Mih (Âncora) |

Papéis viraram mecânica: Suporte → curas/economia de carta; Breaker →
Marca/Exaustão; Duelista → dano + gatilho solo (`benchAtMost 0`); Guardião/
Bastião → Tenacidade/tanque; Controladora/Interdictor → Silêncio/Atordoa/
Imobiliza; Conector/Comandante/Âncora → purificação/curas de equipe.

## 7. Edições — 5 no CORE SET, 10 sidegrades oficiais

Edições são **variantes por `identityId`** (stage 0, mesma identidade) —
nunca estágios/evoluções: `BASE`, `MVP`, `CHAMPION`, `FINALS`, `ICON`.

Os 10 sidegrades curados (substituem o slot oficial e mantêm HP/PV de vitória
— zero power creep automático):

| Edição | Agente | Slot substituído | Ação oficial |
|---|---|---|---|
| MVP | Jenny | Skill | MVP Tempo |
| MVP | Wei Wang | Signature | MVP Lock |
| CHAMPION | Ran Yuki | Signature | Champion Point |
| CHAMPION | Shirakami Niku | Signature | Trono Inabalável |
| CHAMPION | Ryan Smith | Signature | Comando de Campeão |
| CHAMPION | Saki | Signature | Golpe do Título |
| FINALS | Alice Westland | Skill | Final Cover |
| FINALS | Tarruh | Skill | All-In de Final |
| FINALS | Tayná Lannister Müller | Skill | Fechamento de Final |
| ICON | Mik Kashnov | Skill | Ícone de Campo |

Cada variante mantém o mesmo custo de energia do slot que substitui e traz o
`tradeoff` documentado na fonte como flavor. `RIVALRY`/`CHAMPIONSHIP` existem
na fonte só como nomes (sem kit curado) → não foram importadas.

## 8. Starter Decks — 3 (60 cartas, ≤4 cópias, com Agentes Base)

- **Pressão KOF 12** (agressão): Ran Yuki 3, Xixim 3, Shirakami Niku 3,
  Jenny 2 + 30 energias/11 técnicas/4 equipamentos/5 campos.
- **Muralha Asgard** (controle/defesa): Tarruh 3, Alice Westland 3,
  Tayná 3 + 30 energias/11 técnicas/5 equipamentos/5 campos.
- **Comando Morning Star** (versátil/liderança): Ryan Smith 3, Mik Kashnov 3,
  Saki 3, Henry 2 + 29 energias/10 técnicas/5 equipamentos/5 campos.

## 9. Técnicas (10) — `jact-*`

Purificação, Abre-Espaço, Leitura de Combate, Foco Ofensivo, Corte de
Energia, Trincheira, Rally de Equipe, Marca Tática, Recarga Rápida, Retomada.
Gameplay-originais com nomes neutros (a fonte não define técnicas de TCG);
nada afirma fato canônico do universo.

## 10. Equipamentos (5) — `jeq-*`

Manopla Reforçada, Placa de Impacto, Propulsor de Recuo, Núcleo Vital,
Ampulheta Tática.

## 11. Campos e eventos

- **Campos (3)** — `jfd-*`: Arena Oficial, Ovação da Torcida, Zona Neutra.
- **Eventos**: não existem na fonte nem no escopo do CORE SET α; nenhum foi
  inventado. O slot permanece aberto no modelo de dados (`kind: 'FIELD'` já
  cobre o genérico).

**Energia JET (6)** — `jres-*`: Energia JET (curinga), Núcleo de Energia,
Bateria de Campo, Relé de Transferência, Condensador, Descarga Residual.

## 12. Bugs do PR #1 corrigidos nesta etapa

1. **Aura vazava para o oponente** (`queries.ts`): auras `whileActive`/
   `whileBench` buffavam/protegiam o lado inimigo; agora cada aura afeta
   somente o lado do dono.
2. **Deck-out não encerrava a partida** (`engine.ts`): a recompra com baralho
   vazio marcava `winner`/`endReason`, mas o fluxo de início de turno
   reposicionava `phase = 'main'` e o jogo continuava para sempre. Corrigido
   com `return` após o draw quando há vencedor.
3. **IA com hardcode de IDs NEXO** (`ai.ts`): `simulateAttach` criava
   instâncias falsas com `res-neutro`/`res-prisma` e **quebrava** em
   partidas JET (carta não registrada). Agora usa um recurso REALMENTE
   registrado no catálogo ativo (`simResourceDefId`) — sem acoplamento a
   nenhum pack.
4. Migração de save: baralhos salvos com cartas fora do catálogo ativo (era
   NEXO) são descartados com fallback para os starters JET.

Anteriormente no PR (já commitado): gating de `RESOLVE_CHOICE`, custo de
habilidade como objeto, broadcast `__global__` único, correção de TS2552 na IA.

## 13. Arquivos-chave

- `src/data/jet/raw/*.json` + `CAPTURE.md` — captura auditável da fonte.
- `src/data/jet/snapshot.ts` — normalizado (gerado por
  `scripts/import-jet-tactics.ts 769196ea55`).
- `src/data/jet/agentProfiles.ts` — 28 perfis curados + convenções de conversão.
- `src/integrations/jet/{types,normalize,converter,importer,provenance}.ts` — pipeline.
- `src/data/jet/{energy,auxiliares,starterDecks,pack}.ts` — cartas do CORE SET.
- `src/data/deckUtils.ts` — validação/estatísticas genéricas de baralho.
- `src/engine/{engine,queries,rules,validation,types}.ts`,
  `src/engine/effects/*`, `src/engine/ai/ai.ts` — engine (sem conceito "JET").
- `src/data/statuses.ts` — `marked`, `exhausted`, `root`, `tenacity` (+ genéricos).
- `src/game/controller.ts` — tutorial/fallbacks JET; `src/main.tsx` — pack padrão.

## 14. Decisões de arquitetura

1. **Engine neutro, identidade na camada de dados**: o engine só conhece
   CHARACTER/RESOURCE/ACTION/EQUIPMENT/FIELD; "Agente", "Energia JET",
   "Técnica" vêm da terminologia/dados. Nenhuma lógica de jogo na UI — a UI
   envia Commands e desenha eventos.
2. **Import com proveniência por carta** (`sourceRepository/sourceId/commit`),
   captura crua versionada em `raw/`, snapshot normalizado checado no Git —
   zero import por caminho relativo em runtime (sem acoplamento entre repos).
3. **Edições = variantes por `identityId`**; `stage > 0` exige relação
   explícita `upgradesTo` (nenhuma no JET); importador rejeita carta com
   `edition` e `stage > 0` (assert no registro).
4. **Conservação de instâncias**: censo `deck+hand+active+bench+discard+
   attached+progression+fields (+generated)` constante em todos os testes de
   partida; tokens de efeito exigem flag `generated: true`.
5. **`legalActions` e `dispatch` compartilham `src/engine/rules.ts`+`validation.ts`**
   — o que é ofertado é dispatchável; o que não é ofertado é rejeitado
   (testado nos dois sentidos).
6. **Raridade/holo sem poder**: perfis curados usam raridade só como meta-
   informação do CORE SET; holo não é emitida (cosmético futuro).
7. **RNG semeado centralizado**; IA determinística por seed; debug panel só
   em `import.meta.env.DEV`.
8. **Persistência abstrata** (`PersistenceAdapter` + LocalStorage); nenhum
   Firebase/credencial no código (a fonte usava Firebase p/ fórum/inventário —
   não copiamos).

## 15. TCG_PROFILE_PENDING

**Nenhum.** Todos os pares (agente, edição) oficialmente disponíveis na fonte
têm perfil curado (28/28; `jetPendingCatalog() === 0`). O catálogo de
"aguardando adaptação" existe e é funcional para o caso de a fonte passar a
oferecer edições sem kit adaptado.

## 16. Itens de lore não convertidos (e por quê)

- **Supremas / Expansões de Domínio / transformações**: não há dados oficiais
  suficientes na fonte — nada foi inventado; o modelo suporta quando existirem.
- **RIVALRY / CHAMPIONSHIP**: só o nome existe na fonte (sem kit) → não
  importadas como edições.
- **`power.js` (RARITY_PROFILES)**: raro/épico/lendário/holo confeririam
  poder na fonte — viola a regra "raridade não escala poder" → deliberadamente
  não importado.
- **Artes por foto de jogador / inventário do Firebase** (`jet-cards.js`):
  dados de usuário/infra externa — não copiados; cartas usam arte procedural
  (motif+seed).
- **Cores das equipes**: a fonte não define paletas por equipe — facções usam
  o dourado JET neutro; nada inventado.

## 17. Como adicionar carta nova (data-driven)

1. Captura atualizada em `src/data/jet/raw/` (ou entrada nova no snapshot via
   `scripts/import-jet-tactics.ts <commit>`).
2. Perfil em `agentProfiles.ts` (ou auxiliar em `energy/auxiliares.ts`).
3. `registerJetDataPack()` registra automaticamente; testes de invariante e
   validação de baralho valem de graça. **Nenhuma mudança de engine/UI.**

## 18. Como rodar

`npm install && npm run dev` (ou `npm run build && npm run preview`).
Título → Baralhos (3 starters JET) → Partida (PvE com IA em 3 níveis, ou
IA×IA pelo debug). Tutorial guiado em PT-BR com o roster JET.
