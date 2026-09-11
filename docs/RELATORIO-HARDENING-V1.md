# RELATÓRIO — JET TCG v1 Hardening (rodada pós-PR #1)

Rodada de **robustez, confiabilidade e jogabilidade** sobre o PR #1 (merge
`c8ab92b`). Nenhuma feature nova, nenhum rebalance: correções de bugs reais,
proteções por teste e fechamento de lacunas de produto. Branch
`fix/jet-tcg-hardening-v1`, commits locais (remoto indisponível nesta sessão).

---

## 1. Verificação — separada por nível de confiança (item 64)

| Nível | O que foi verificado | Resultado |
|---|---|---|
| **Automático (testes)** | `vitest run`: **235/235** em 13 arquivos — inclui bateria de **135 partidas IA×IA** (9 pareamentos × 3 dificuldades × 5 seeds) com comando ilegal = falha, conservação de instâncias e UID único em cada partida | ✅ |
| **Automático (tipos)** | `tsc --noEmit` — 0 erros | ✅ |
| **Build** | `npm run build` sem clone externo — `344.27 kB` / gzip `100.13 kB` | ✅ |
| **Headless extra** | Replay determinístico bit a bit (mesma seed → mesmo estado final JSON) | ✅ |
| **Navegador real** | **NÃO executado nesta rodada.** Smoke manual pendente: tutorial clicável, revanche, decks salvos, responsivo 360/390/768/1024/1440 | ⏳ pendente |
| **E2E (Playwright)** | Não adicionado (não era "razoavelmente adicionar" sem infra de browser no sandbox) | ⏳ documentado |
| **Lint** | Não configurado no repositório (ESLint ausente — documentado no CI) | ➖ N/A |

**Nenhuma alegação de "sem bugs" / "100%".** O que está em verde acima é
exatamente o que a suíte cobre.

## 2. Bugs reais encontrados e corrigidos nesta rodada

1. **Sinal de `damageTakenFlat` invertido** (`queries.ts`): equipamentos/auras
   defensivos (Placa de Impacto, Condensador, aura de Henry) **aumentavam** o
   dano recebido. Convenção única agora: positivo = redução (igual a StatusDef),
   documentada em `ops.ts`/`queries.ts`.
2. **`reduceDamage` (Trincheira) com dupla negação** (`ops.ts`): gravava
   `-(amount)` e, sob a convenção corrigida, virava +30 de dano recebido.
3. **Custo de recuo ignorava mod de RECURSO** (`queries.ts`): o texto do Relé de
   Transferência era morto; `retreatCostOf` agora lê `retreatCostMod` de recursos.
4. **Gate `choice_pending` era código morto** (`engine.ts`): `dispatch` limpava
   o pending antes de executar, abandonando geradores suspensos no meio de
   efeitos. Comandos normais com escolha pendente agora são **rejeitados**.
5. **`RESOLVE_CHOICE` sem validação** (`engine.ts`): uid fora dos candidatos,
   contagem fora de min/max e respostas duplicadas entravam direto no gerador.
   Agora: `invalid_choice_selection`; pendência preservada para nova tentativa.
6. **Fallback silencioso de END_TURN para IA ilegal** (`controller.ts`): proibido
   pelo item 31 — removido; comando ilegal da IA agora é exibido e o tick para
   (bug denunciado, não mascarado).
7. **`CONCEDE` após fim de partida retornava ok** (`engine.ts`): agora rejeita
   com `game_over`.
8. **`MetaStore.save()` propagava falha de adapter** (`store.ts`): storage cheio
   derrubava o fluxo; agora best-effort (estado válido em memória).
9. **`favorites`/`history`/placar ausentes no save** não eram preenchidos na
   migração; send() em controller parado aceitava comandos. Corrigidos.
10. **Mods zero mortos** removidos dos dados (`jeq-ampulheta`, `jres-rele`).

## 3. Cobertura por item do pedido (70 itens)

| Itens | Escopo | Estado |
|---|---|---|
| 2 | Tutorial 100% JET (decks reais, mão viciada, fluxo de botões testado) | ✅ (27e98c4) |
| 3–5 | Produção standalone sem NEXO; auditoria de imports; identidade jet-tcg (pacote/index/README) | ✅ |
| 6–8 | Edições por composição (baseProfile+sidegrade); slot por metadado explícito (`role: skill/signature`); 10 testes por edição | ✅ (detecção por custo proibida e testada) |
| 9 | Integridade dos 18 agentes (ids, HP, PV, facção, ataques, custos, ops) | ✅ |
| 10 | Efeito vs texto (todas as técnicas/equips/recursos/campos JET + Suprema fixture) | ✅ |
| 11 | Ordenação de efeitos protegida por **determinismo de replay bit a bit** | ✅ |
| 12–18 | Status: marcação, exaustão, stun≠exaustão, silêncio, raiz, tenacidade (50−20=30), convenção de Mods documentada | ✅ (jet-statuses) |
| 19–21 | Equipamentos (slots, descarte, conservação); energias (curinga, temporárias, transferência) | ✅ (jet-cards) |
| 22–24 | Técnicas (oncePerTurn, sem perda de carta); campos (escopo, substituição); DOMAIN fixture | ✅ |
| 25–29 | Vitória por PV (exata/acima/simultânea), derrota sem ativo + promoção, deck-out (draw e técnica), concede, sistema de escolha completo (inválida/jogador errado/sem pendência) | ✅ (jet-matches) |
| 30–33 | Bateria IA×IA: 135 partidas, 3 decks × 3 dificuldades × 5 seeds; **qualquer comando ilegal FALHA**; IA escolhe só de `legalActions()` | ✅ |
| 34–35 | Censo de conservação + UID único em toda partida automatizada (upgrade/equip/temporário/campo/retorno/mão) | ✅ |
| 36–37 | Saves resilientes (11 testes): vazio, válido, corrompido, legado NEXO, carta removida, versão futura, campos ausentes, storage cheio; schemaVersion + migração v1→v2 documentada | ✅ |
| 38–39 | ErrorBoundary React (tela amigável, voltar ao menu limpa partida, detalhes só em dev) — com testes; erros inesperados do engine **não** são mascarados como "ação inválida" | ✅ |
| 40–43 | Responsivo 360–1440 (breakpoints 420/700/980/1024+), touch (touch-action, sem dependência de hover), a11y (foco visível global, cards clicáveis com role/tabIndex/teclado/aria-label, Escape fecha modais), timers todos com cleanup, revanche mata controller antigo | ✅ (estático + tsc; navegador real pendente) |
| 44–45 | Revanche = engine/seed novos, sem vazamento; exatamente 1 entrada de histórico por partida; tutorial não polui W/L | ✅ testado |
| 46–49 | Deck builder com validação central (`validateDeck`): 60 máx, 4 cópias, limite **por identidade compartilhado entre variantes**, starter obrigatório, erros explicados; coleção agrupada por identityId; arte procedural determinística | ✅ |
| 50–52 | Provenância normalizada; README standalone (Jet Tactics só sync deliberado); build sem clone | ✅ |
| 53–55 | `.github/workflows/ci.yml` (push+PR: npm ci, typecheck, test, bateria longa, build); typecheck script existente; lint inexistente documentado no workflow | ✅ |
| 56–57 | Registro: ids únicos, ataques coerentes, ops/status/facções válidos; `registerJetDataPack` idempotente | ✅ |
| 58 | UPGRADE entre edições (Jenny BASE→MVP) **rejeitado** — edições não são estágios | ✅ testado |
| 59–60 | Estágios/família/upgradesTo via fixtures genéricas; Suprema (estrutura) só fixture; zero conteúdo novo | ✅ |
| 61 | Comentários "NEXO Engine" em arquivos genéricos → cabeçalhos neutros | ✅ |
| 62 | UI smoke: coberto por boundary/fluxo testados headless; clique-real pendente no navegador | ⏳ parcial |
| 63 | E2E: não adicionado — documentado como pendência (sem infra de browser aqui) | ⏳ documentado |
| 65–67 | Sem rebalance; sem PvP online; sem Firebase | ✅ respeitado |
| 68–70 | Este relatório + checklist de aceite; DoD abaixo | ✅ |

## 4. Commits desta rodada (branch `fix/jet-tcg-hardening-v1`)

| Commit | Conteúdo |
|---|---|
| `27e98c4` | Runtime sem NEXO, tutorial JET, edições por composição, slots explícitos, sinais de status |
| `34d7bad` | Suítes de proteção: produção standalone, 10 edições, integridade dos 18 agentes, status numerados |
| `05115f0` | Bateria IA×IA estrita, fins de partida, sistema de escolha; fix `choice_pending` morto + validação de RESOLVE_CHOICE |
| `704f66c` | Resiliência de save (11 testes), error boundary com testes, IA sem fallback silencioso |
| `ad17177` | História/rematch/tutorial, limite por identidade compartilhado, arte procedural; send() recusa controller parado |
| `0fa1157` | A11y + responsivo + CI workflow + cabeçalhos neutros |
| `f04c1cf` | Determinismo bit a bit de replay |

## 5. Definition of Done — checklist honesto

- [x] v1 standalone e jogável do menu ao fim (menus → deck → partida → resultados → histórico)
- [x] Tutorial JET funcional com decks reais e passos testados
- [x] 3 starters válidos (60 cartas, regras centrais, validados)
- [x] IA termina partidas — **135/135** sem trava e sem jogada ilegal em 3 dificuldades
- [x] Engine consistente — legalActions ≡ dispatch, conservação, UIDs únicos, determinismo
- [x] Saves resilientes — nenhum cenário corrompido/legado/futuro quebra (tela branca impossível via ErrorBoundary + migração)
- [x] Suíte protege regras críticas — 235 testes + bateria longa opcional no CI
- [ ] **Pendente**: smoke em navegador real (fluxo de clique, visual responsivo) e E2E automatizado — únicas verificação NÃO executadas nesta rodada
