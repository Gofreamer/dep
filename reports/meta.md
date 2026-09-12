# JET TCG 2.0 — Meta Report

Gerado por `scripts/meta-sim.ts` — 1024 partidas reais IA×IA.

===== REGISTRY REPORT =====
JET CardDefs reais: 155
  Agentes BASE: 18
  Edições (variantes): 10
  Energia: 10
  Técnicas: 48
  Equipamentos: 26
  Campos: 19
  Equipe/sinergia: 24
  Identidades de agente: 18
Fixture/test CardDefs: 0
Outros CardDefs: 0
Total registry em teste: 155

## Meta Simulation — 1024 partidas (8 decks)

### Win rates
| Deck | Win rate | Turnos médios | Dano médio | Cura média | Energias | KOs |
|---|---|---|---|---|---|---|
| Pressão KOF 12 | 78.9% | 12.1 | 72 | 2 | 1.8 | 0.4 |
| Muralha Asgard | 60.5% | 23.0 | 130 | 55 | 2.6 | 0.5 |
| Comando Morning Star | 66.4% | 15.1 | 86 | 27 | 3.1 | 0.4 |
| Tubarões XYZ | 48.4% | 8.8 | 85 | 0 | 0.8 | 0.6 |
| Blackout R6 | 29.7% | 19.4 | 154 | 0 | 0.4 | 1.1 |
| Precisão Platinum | 36.3% | 10.3 | 95 | 0 | 0.9 | 0.7 |
| Âncora Weigon | 43.0% | 18.2 | 183 | 73 | 1.2 | 0.7 |
| Caçada Salvatore | 36.7% | 9.8 | 102 | 0 | 0.9 | 0.8 |

### Matchup matrix (linha = perspectiva da coluna de cima)
|  | Pressão KOF 12 | Muralha Asgard | Comando Morning Star | Tubarões XYZ | Blackout R6 | Precisão Platinum | Âncora Weigon | Caçada Salvatore |
|---|---|---|---|---|---|---|---|---|
| Pressão KOF 12 | 56.3% | 87.5% | 62.5% | 87.5% | 93.8% | 93.8% | 75.0% | 100.0% |
| Muralha Asgard | 31.3% | 50.0% | 43.8% | 68.8% | 93.8% | 81.3% | 87.5% | 75.0% |
| Comando Morning Star | 43.8% | 37.5% | 37.5% | 75.0% | 75.0% | 93.8% | 93.8% | 87.5% |
| Tubarões XYZ | 12.5% | 37.5% | 43.8% | 62.5% | 75.0% | 81.3% | 62.5% | 56.3% |
| Blackout R6 | 12.5% | 37.5% | 18.8% | 37.5% | 56.3% | 56.3% | 37.5% | 43.8% |
| Precisão Platinum | 18.8% | 37.5% | 43.8% | 25.0% | 62.5% | 62.5% | 50.0% | 68.8% |
| Âncora Weigon | 6.3% | 18.8% | 6.3% | 68.8% | 93.8% | 68.8% | 43.8% | 56.3% |
| Caçada Salvatore | 12.5% | 56.3% | 25.0% | 31.3% | 75.0% | 50.0% | 25.0% | 56.3% |

### Cartas mais usadas
- Energia JET (jres-energia): 6333×
- Tarruh (agent-tarruh-base): 2049×
- Wei Fang (agent-wei-fang-base): 1074×
- Tayná Lannister Müller (agent-tayna-lannister-muller-base): 858×
- Baek Seo-jin (agent-baek-seo-jin-base): 811×
- Saki (agent-saki-base): 804×
- Henry (agent-henry-base): 749×
- Ruby (agent-ruby-base): 747×
- Olivia Mih (agent-olivia-mih-base): 739×
- Shirakami Niku (agent-shirakami-niku-base): 690×
- Wei Wang (agent-wei-wang-base): 521×
- Xixim (agent-xixim-base): 510×
- Alice Westland (agent-alice-westland-base): 430×
- Hashika Gloves (agent-hashika-gloves-base): 403×
- Ryan Smith (agent-ryan-smith-base): 402×
- Kaio (agent-kaio-base): 388×
- Mik Kashnov (agent-mik-kashnov-base): 380×
- Ran Yuki (agent-ran-yuki-base): 376×
- Jenny (agent-jenny-base): 241×
- Rede de Comando (jsyn-ms-rede): 240×

### Cartas menos usadas
- Overclock (jres-overclock): 17×
- Isca Viva (jsyn-tub-isca): 28×
- Zona de Troca (jfd-zona-de-troca): 28×
- Rastro do Caçador (jsyn-salv-rastro): 30×
- Ultimato KOF (jeq-ultimato-kof): 35×
- Plano Mestre (jsyn-plat-plano): 37×
- Espreita (jsyn-salv-espreita): 40×
- All-In Tubarão (jact-allin): 41×
- Relé de Transferência (jres-rele): 42×
- Frenesi Tubarão (jsyn-tub-frenesi): 43×
- Troca Violenta (jact-troca-violenta): 44×
- Dentes Expostos (jact-dentes): 45×
- Luva de Caçador (jeq-luva-rapida): 47×
- Preparação (jact-preparacao): 47×
- Respiro de Combate (jsyn-weigon-respiro): 48×
- Protocolo Blackout (jeq-protocolo-r6): 52×
- Luneta de Precisão (jeq-luneta): 54×
- Resiliência de Equipe (jact-resiliencia): 56×
- Maré de Weigon (jsyn-weigon-mare): 56×
- Bastião de Asgard (jfd-bastiao-asgard): 58×

### Cartas nunca usadas
- nenhuma

### ⚠️ Dominância universal (>65% contra o field inteiro)
- archetype-aggro: 78.9%
- archetype-midrange: 66.4%