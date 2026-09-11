/**
 * GERADO POR scripts/import-jet-tactics.ts — NÃO EDITAR À MÃO.
 * Captura de 2026-09-10 (commit 769196ea55).
 * Agentes: 18 · Kits: 18 · Edições: 5 · Equipes: 8 · Sidegrades curados: 10
 *
 * Fonte: RocksXB/jet-tactics @ 769196ea55 (repo real: "jet-tactics." com ponto final)
 * docs/CURATED_ROSTER_v0.1.md + js/game/curated-agents-1..6.js + js/game/editions.js
 */
import type { JetSnapshot } from '../../integrations/jet/types';

export const JET_SNAPSHOT: JetSnapshot = {
  "version": 1,
  "setName": "JET CORE SET — Alpha",
  "sourceCommit": "769196ea55",
  "capturedAt": "2026-09-10",
  "teams": [
    {
      "id": "kof-12",
      "name": "KOF 12",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "kof-12",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "asgard",
      "name": "Asgard",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "asgard",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "morning-star",
      "name": "Morning Star",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "morning-star",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "bastard-gran-tubaroes-xyz",
      "name": "Bastard Gran Tubarões XYZ",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "bastard-gran-tubaroes-xyz",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "rainbow-six",
      "name": "Rainbow Six",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "rainbow-six",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "salvatore",
      "name": "Salvatore",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "salvatore",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "platinum",
      "name": "Platinum",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "platinum",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "weigon",
      "name": "Weigon",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "agents",
        "sourceId": "weigon",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    }
  ],
  "editions": [
    {
      "id": "BASE",
      "name": "Base",
      "sidegradeIntent": "Kit padrão do agente.",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "editions",
        "sourceId": "BASE",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "MVP",
      "name": "MVP",
      "sidegradeIntent": "Troca a Skill (ou Signature) por variante de prêmio individual — sidegrade.",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "editions",
        "sourceId": "MVP",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "CHAMPION",
      "name": "Champion",
      "sidegradeIntent": "Troca a Signature por variante de campeonato — sidegrade.",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "editions",
        "sourceId": "CHAMPION",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "FINALS",
      "name": "Finals",
      "sidegradeIntent": "Troca a Skill por variante de final — sidegrade.",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "editions",
        "sourceId": "FINALS",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "id": "ICON",
      "name": "Icon",
      "sidegradeIntent": "Troca a Skill por variante ícone — sidegrade premium.",
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "editions",
        "sourceId": "ICON",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    }
  ],
  "agents": [
    {
      "agentId": "agent-hashika-gloves",
      "playerKey": "salvatore_hashika gloves",
      "name": "Hashika Gloves",
      "team": "salvatore",
      "description": "Hashika abre uma caçada com Marca e precisa decidir entre manter a presa exposta ou consumi-la para fechar a zona.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#salvatore_hashika gloves",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-henry",
      "playerKey": "morning star_henry",
      "name": "Henry",
      "team": "morning star",
      "description": "Henry abre um corredor de retirada: segura a zona atual e restaura aliados posicionados ao redor dela.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_henry",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-kaio",
      "playerKey": "bastard gran tubaroes xyz_kaio",
      "name": "Kaio",
      "team": "bastard gran tubaroes xyz",
      "description": "Kaio prepara uma fratura visível e recompensa o Confronto contra a presa antes de consumir a Marca no colapso.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#bastard gran tubaroes xyz_kaio",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-baek-seo-jin",
      "playerKey": "platinum_baek seo-jin",
      "name": "Baek Seo-jin",
      "team": "platinum",
      "description": "Baek instala uma janela de interferência e transforma recarga sabotada em ameaça telegráfica de Atordoamento.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#platinum_baek seo-jin",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-jenny",
      "playerKey": "kof 12_jenny",
      "name": "Jenny",
      "team": "kof 12",
      "description": "Jenny transforma Apoio em economia e reserva sua Suprema para recuperar exatamente as linhas que já estão sob pressão.",
      "editions": [
        "BASE",
        "MVP"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_jenny",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-olivia-mih",
      "playerKey": "weigon_olivia mih",
      "name": "Olivia Mih",
      "team": "weigon",
      "description": "Olivia converte defesa em estabilização: cada Proteção limpa a linha local e a Suprema recompensa frentes comprometidas.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#weigon_olivia mih",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-wei-fang",
      "playerKey": "rainbow six_wei fang",
      "name": "Wei Fang",
      "team": "rainbow six",
      "description": "Wei Fang transforma recarga inimiga em território e usa essa mesma janela para financiar o Blackout.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#rainbow six_wei fang",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ruby",
      "playerKey": "bastard gran tubaroes xyz_ruby",
      "name": "Ruby",
      "team": "bastard gran tubaroes xyz",
      "description": "Ruby domina o espaço vazio, prepara uma Marca curta e a converte em aprisionamento e perda de presença.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#bastard gran tubaroes xyz_ruby",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-xixim",
      "playerKey": "kof 12_xixim",
      "name": "Xixim",
      "team": "kof 12",
      "description": "Xixim pune zonas sem cobertura e espalha o custo de sua Ruptura para as duas frentes vizinhas.",
      "editions": [
        "BASE"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_xixim",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-alice-westland",
      "playerKey": "asgard_alice westland",
      "name": "Alice Westland",
      "team": "asgard",
      "description": "Alice usa cada Apoio para acelerar a linha local e transforma a Suprema numa rotação de Habilidades em toda a formação.",
      "editions": [
        "BASE",
        "FINALS"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_alice westland",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-tarruh",
      "playerKey": "asgard_tarruh",
      "name": "Tarruh",
      "team": "asgard",
      "description": "Tarruh protege em profundidade e projeta resistência para as zonas vizinhas sem transformar a arena inteira num escudo.",
      "editions": [
        "BASE",
        "FINALS"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_tarruh",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-tayna-lannister-muller",
      "playerKey": "asgard_tayna lannister muller",
      "name": "Tayná Lannister Müller",
      "team": "asgard",
      "description": "Tayná transforma vantagem em contenção: taxa uma linha e faz a Suprema alcançar somente inimigos cuja janela especial já foi comprometida.",
      "editions": [
        "BASE",
        "FINALS"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_tayna lannister muller",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ran-yuki",
      "playerKey": "kof 12_ran yuki",
      "name": "Ran Yuki",
      "team": "kof 12",
      "description": "Ran acelera quando o Ímpeto acaba e usa sua Suprema como ferramenta de recuperação quando o placar pede risco.",
      "editions": [
        "BASE",
        "CHAMPION"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_ran yuki",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-shirakami-niku",
      "playerKey": "kof 12_shirakami niku",
      "name": "Shirakami Niku",
      "team": "kof 12",
      "description": "Shirakami concentra o maior reset defensivo do elenco numa Suprema única, mantendo a Habilidade estritamente local.",
      "editions": [
        "BASE",
        "CHAMPION"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_shirakami niku",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-wei-wang",
      "playerKey": "rainbow six_wei wang",
      "name": "Wei Wang",
      "team": "rainbow six",
      "description": "Wei Wang mostra a ameaça antes de executá-la: a Marca fortalece sua defesa e é o requisito do Atordoamento da Suprema.",
      "editions": [
        "BASE",
        "MVP"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#rainbow six_wei wang",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-mik-kashnov",
      "playerKey": "morning star_mik kashnov",
      "name": "Mik Kashnov",
      "team": "morning star",
      "description": "Mik é mais eficiente no Centro e usa a malha lateral para acelerar agentes fora da própria zona.",
      "editions": [
        "BASE",
        "ICON"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_mik kashnov",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ryan-smith",
      "playerKey": "morning star_ryan smith",
      "name": "Ryan Smith",
      "team": "morning star",
      "description": "Ryan ganha eficiência quando precisa buscar o placar e converte esse estado em proteção e resistência coletiva.",
      "editions": [
        "BASE",
        "CHAMPION"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_ryan smith",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-saki",
      "playerKey": "morning star_saki",
      "name": "Saki",
      "team": "morning star",
      "description": "Saki planta a Marca com Confronto e escolhe entre cobrá-la por recurso ou espalhar o abalo para as zonas vizinhas.",
      "editions": [
        "BASE",
        "CHAMPION"
      ],
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_saki",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    }
  ],
  "kits": [
    {
      "agentId": "agent-hashika-gloves",
      "role": "Duelista",
      "archetype": "duelist",
      "summary": "Hashika abre uma caçada com Marca e precisa decidir entre manter a presa exposta ou consumi-la para fechar a zona.",
      "passive": {
        "name": "Predador à Vista",
        "description": "Disputa gera +1 Influência contra uma Vanguarda Marcada."
      },
      "skill": {
        "name": "Rastro de Corte",
        "description": "+1 Influência e Marca a Vanguarda rival por 2 rodadas."
      },
      "signature": {
        "name": "Quarto Fechado",
        "description": "+3 Influência e corta Apoio. Silencia a Vanguarda rival; se ela estiver Marcada, também a Imobiliza e consome a Marca."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#salvatore_hashika gloves",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-henry",
      "role": "Guardião",
      "archetype": "guardian",
      "summary": "Henry abre um corredor de retirada: segura a zona atual e restaura aliados posicionados ao redor dela.",
      "passive": {
        "name": "Interceptação de Escolta",
        "description": "Proteção de Henry na Retaguarda também protege o aliado da Vanguarda da mesma zona contra Confronto."
      },
      "skill": {
        "name": "Corredor Seguro",
        "description": "+2 Influência, bloqueia Confronto e concede Tenacidade ao aliado da Vanguarda."
      },
      "signature": {
        "name": "Extração em Cadeia",
        "description": "+2 Influência e bloqueia todos os Confrontos. Purifica a Vanguarda local e as Vanguardas adjacentes, além de reduzir em 1 a recarga local."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_henry",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-kaio",
      "role": "Breaker",
      "archetype": "breaker",
      "summary": "Kaio prepara uma fratura visível e recompensa o Confronto contra a presa antes de consumir a Marca no colapso.",
      "passive": {
        "name": "Cobrança da Fratura",
        "description": "Confronto reduz 2 Influência quando a Vanguarda rival está Marcada; sem Marca, reduz 1."
      },
      "skill": {
        "name": "Ruptura Violeta",
        "description": "-1 Influência, tenta causar Ruptura e Marca a Vanguarda rival por 2 rodadas."
      },
      "signature": {
        "name": "Colapso em Cadeia",
        "description": "-2 Influência e tenta causar Ruptura. Aplica Exaustão; contra alvo Marcado, rouba 1 Ímpeto e consome a Marca."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#bastard gran tubaroes xyz_kaio",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-baek-seo-jin",
      "role": "Controlador",
      "archetype": "controller",
      "summary": "Baek instala uma janela de interferência e transforma recarga sabotada em ameaça telegráfica de Atordoamento.",
      "passive": {
        "name": "Eco de Interferência",
        "description": "Ao Proteger contra uma Vanguarda Silenciada, aumenta em 1 a recarga da Habilidade dela."
      },
      "skill": {
        "name": "Interferência Fantasma",
        "description": "-1 Influência, Silencia a Vanguarda rival e aumenta em 1 a recarga da Habilidade dela."
      },
      "signature": {
        "name": "Lockdown Neural",
        "description": "-2 Influência, corta Apoio e Atordoa a Vanguarda rival. Se a Habilidade dela estiver em recarga, também a Imobiliza."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#platinum_baek seo-jin",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-jenny",
      "role": "Suporte",
      "archetype": "support",
      "summary": "Jenny transforma Apoio em economia e reserva sua Suprema para recuperar exatamente as linhas que já estão sob pressão.",
      "passive": {
        "name": "Batida que se Paga",
        "description": "Ao Apoiar, recupera 1 Ímpeto; o Apoio mantém sua Influência normal."
      },
      "skill": {
        "name": "Impulso de Equipe",
        "description": "+2 Influência, recupera 1 Ímpeto e Purifica o aliado da Vanguarda."
      },
      "signature": {
        "name": "Todos no Ritmo",
        "description": "+1 Influência em cada zona com Vanguarda aliada. Vanguardas sob estado negativo recebem Tenacidade antes de serem Purificadas."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_jenny",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-olivia-mih",
      "role": "Âncora",
      "archetype": "guardian",
      "summary": "Olivia converte defesa em estabilização: cada Proteção limpa a linha local e a Suprema recompensa frentes comprometidas.",
      "passive": {
        "name": "Âncora Restauradora",
        "description": "Proteção na Retaguarda também intercepta Confronto; ao Proteger, Purifica a Vanguarda aliada da zona."
      },
      "skill": {
        "name": "Ponto de Retorno",
        "description": "+1 Influência, bloqueia Confronto, Purifica e concede Tenacidade ao aliado da Vanguarda."
      },
      "signature": {
        "name": "Campo de Estabilidade",
        "description": "+2 Influência e bloqueia todos os Confrontos. Cada Vanguarda aliada sob estado negativo recebe +1 Influência antes de ser Purificada."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#weigon_olivia mih",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-wei-fang",
      "role": "Interdictor",
      "archetype": "controller",
      "summary": "Wei Fang transforma recarga inimiga em território e usa essa mesma janela para financiar o Blackout.",
      "passive": {
        "name": "Janela de Contra-Sinal",
        "description": "Proteção gera +1 Influência quando a Habilidade da Vanguarda rival está em recarga."
      },
      "skill": {
        "name": "Corte de Canal",
        "description": "-1 Influência, corta Apoio, aplica Exaustão e aumenta em 1 a recarga da Vanguarda rival."
      },
      "signature": {
        "name": "Blackout Tático",
        "description": "-2 Influência e Silencia a Vanguarda rival. Se a Habilidade dela estiver em recarga, rouba 1 Ímpeto."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#rainbow six_wei fang",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ruby",
      "role": "Duelista",
      "archetype": "duelist",
      "summary": "Ruby domina o espaço vazio, prepara uma Marca curta e a converte em aprisionamento e perda de presença.",
      "passive": {
        "name": "Palco sem Testemunhas",
        "description": "Disputa gera +1 Influência quando Ruby não possui aliado na Retaguarda da mesma zona."
      },
      "skill": {
        "name": "Finta Rubra",
        "description": "+1 Influência, corta Apoio e Marca a Vanguarda rival por 2 rodadas."
      },
      "signature": {
        "name": "Tudo no Vermelho",
        "description": "+3 Influência e Imobiliza a Vanguarda rival. Se ela estiver Marcada, perde mais 1 Influência e a Marca é consumida."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#bastard gran tubaroes xyz_ruby",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-xixim",
      "role": "Breaker",
      "archetype": "breaker",
      "summary": "Xixim pune zonas sem cobertura e espalha o custo de sua Ruptura para as duas frentes vizinhas.",
      "passive": {
        "name": "Alvo sem Amortecimento",
        "description": "Confronto reduz 2 Influência quando o rival não possui agente na Retaguarda da zona."
      },
      "skill": {
        "name": "Tranco Seco",
        "description": "-1 Influência e aplica Exaustão. Se o rival tiver ao menos 4 Ímpeto, também drena 1."
      },
      "signature": {
        "name": "Queda de Ritmo",
        "description": "-2 Influência, tenta causar Ruptura e drena 1 Ímpeto. As Vanguardas inimigas adjacentes ficam Exaustas."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_xixim",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-alice-westland",
      "role": "Suporte",
      "archetype": "support",
      "summary": "Alice usa cada Apoio para acelerar a linha local e transforma a Suprema numa rotação de Habilidades em toda a formação.",
      "passive": {
        "name": "Passe de Revezamento",
        "description": "Ao Apoiar, reduz em 1 a recarga da Habilidade do aliado da Vanguarda."
      },
      "skill": {
        "name": "Reforço Lateral",
        "description": "+1 Influência. Se o aliado da Vanguarda estiver sob estado negativo, recebe Tenacidade antes de ser Purificado."
      },
      "signature": {
        "name": "Rotação Asgard",
        "description": "+1 Influência em cada zona com Vanguarda aliada e reduz em 1 a recarga de todas essas Vanguardas."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_alice westland",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-tarruh",
      "role": "Guardião",
      "archetype": "guardian",
      "summary": "Tarruh protege em profundidade e projeta resistência para as zonas vizinhas sem transformar a arena inteira num escudo.",
      "passive": {
        "name": "Segunda Linha",
        "description": "Proteção na Retaguarda também intercepta Confronto e concede Tenacidade à Vanguarda aliada da zona."
      },
      "skill": {
        "name": "Linha de Aço",
        "description": "+2 Influência, bloqueia Confronto e concede Tenacidade ao aliado da Vanguarda."
      },
      "signature": {
        "name": "Parede de Asgard",
        "description": "+3 Influência e bloqueia todos os Confrontos da zona. Purifica e concede Tenacidade às Vanguardas aliadas adjacentes."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_tarruh",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-tayna-lannister-muller",
      "role": "Controladora",
      "archetype": "controller",
      "summary": "Tayná transforma vantagem em contenção: taxa uma linha e faz a Suprema alcançar somente inimigos cuja janela especial já foi comprometida.",
      "passive": {
        "name": "Decreto de Vantagem",
        "description": "Proteção gera +1 Influência enquanto Tayná estiver à frente em Domínio."
      },
      "skill": {
        "name": "Corte de Ritmo",
        "description": "-1 Influência, aplica Exaustão e aumenta em 1 a recarga da Vanguarda rival."
      },
      "signature": {
        "name": "Fecho Real",
        "description": "-2 Influência, corta Apoio e drena 1 Ímpeto na zona. Toda Vanguarda inimiga com Habilidade em recarga fica Silenciada."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#asgard_tayna lannister muller",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ran-yuki",
      "role": "Duelista",
      "archetype": "duelist",
      "summary": "Ran acelera quando o Ímpeto acaba e usa sua Suprema como ferramenta de recuperação quando o placar pede risco.",
      "passive": {
        "name": "Segundo Fôlego",
        "description": "Disputa gera +1 Influência quando Ran começa a resolução com até 2 Ímpeto."
      },
      "skill": {
        "name": "Ponto de Entrada",
        "description": "+2 Influência e recupera 1 Ímpeto durante a resolução."
      },
      "signature": {
        "name": "Duelo de Set",
        "description": "+3 Influência, corta Apoio e Marca a Vanguarda rival por 2 rodadas. Se estiver atrás em Domínio, recupera 1 Ímpeto."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_ran yuki",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-shirakami-niku",
      "role": "Bastião",
      "archetype": "guardian",
      "summary": "Shirakami concentra o maior reset defensivo do elenco numa Suprema única, mantendo a Habilidade estritamente local.",
      "passive": {
        "name": "Trono Inabalável",
        "description": "Proteção na Retaguarda também protege o aliado da Vanguarda da mesma zona contra Confronto."
      },
      "skill": {
        "name": "Fortaleza Móvel",
        "description": "+2 Influência, bloqueia todos os Confrontos e concede Tenacidade ao aliado da Vanguarda."
      },
      "signature": {
        "name": "Trono Absoluto",
        "description": "+3 Influência, bloqueia todos os Confrontos, Purifica e concede Tenacidade a todas as Vanguardas aliadas."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#kof 12_shirakami niku",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-wei-wang",
      "role": "Controlador",
      "archetype": "controller",
      "summary": "Wei Wang mostra a ameaça antes de executá-la: a Marca fortalece sua defesa e é o requisito do Atordoamento da Suprema.",
      "passive": {
        "name": "Disciplina sobre a Presa",
        "description": "Proteção gera +1 Influência contra uma Vanguarda Marcada."
      },
      "skill": {
        "name": "Interdição",
        "description": "-1 Influência, Marca a Vanguarda rival por 2 rodadas e aumenta em 1 sua recarga."
      },
      "signature": {
        "name": "Zona Morta",
        "description": "-2 Influência, corta Apoio e Atordoa a Vanguarda rival. Se estiver Marcada, também a Imobiliza e consome a Marca."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#rainbow six_wei wang",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-mik-kashnov",
      "role": "Conector",
      "archetype": "support",
      "summary": "Mik é mais eficiente no Centro e usa a malha lateral para acelerar agentes fora da própria zona.",
      "passive": {
        "name": "Nó Central",
        "description": "Apoio gera +2 Influência no Centro e +1 nas demais zonas."
      },
      "skill": {
        "name": "Pulso de Retorno",
        "description": "+1 Influência, reduz em 1 a recarga da Vanguarda aliada e recupera 1 Ímpeto."
      },
      "signature": {
        "name": "Malha Morning Star",
        "description": "+1 Influência em cada zona com Vanguarda aliada, reduz a recarga das Vanguardas adjacentes e recupera 1 Ímpeto se estiver atrás em Domínio."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_mik kashnov",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-ryan-smith",
      "role": "Comandante",
      "archetype": "support",
      "summary": "Ryan ganha eficiência quando precisa buscar o placar e converte esse estado em proteção e resistência coletiva.",
      "passive": {
        "name": "Ordem de Recuperação",
        "description": "Apoio gera +2 Influência enquanto Ryan estiver atrás em Domínio; empatado ou à frente, gera +1."
      },
      "skill": {
        "name": "Linha de Comando",
        "description": "+1 Influência, bloqueia Confronto e Purifica a Vanguarda aliada. Se estiver atrás em Domínio, recebe +1 Influência adicional."
      },
      "signature": {
        "name": "Todos de Pé",
        "description": "+1 Influência em cada zona com Vanguarda aliada e concede Tenacidade a todas elas. Se estiver atrás em Domínio, recupera 1 Ímpeto."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_ryan smith",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    },
    {
      "agentId": "agent-saki",
      "role": "Breaker",
      "archetype": "breaker",
      "summary": "Saki planta a Marca com Confronto e escolhe entre cobrá-la por recurso ou espalhar o abalo para as zonas vizinhas.",
      "passive": {
        "name": "Marca de Impacto",
        "description": "Após um Confronto não bloqueado, Marca a Vanguarda atingida por 2 rodadas."
      },
      "skill": {
        "name": "Fissura de Cobrança",
        "description": "-1 Influência e tenta causar Ruptura. Contra alvo Marcado, rouba 1 Ímpeto e consome a Marca."
      },
      "signature": {
        "name": "Abalo Final",
        "description": "-2 Influência, tenta causar Ruptura e Silencia a Vanguarda atingida. Vanguardas inimigas adjacentes ficam Exaustas."
      },
      "provenance": {
        "sourceRepository": "RocksXB/jet-tactics.",
        "sourceType": "curated-agents",
        "sourceId": "curated-agents-6#morning star_saki",
        "capturedAt": "2026-09-10",
        "sourceCommit": "769196ea55"
      }
    }
  ],
  "editionVariants": [
    {
      "agentId": "agent-jenny",
      "playerKey": "kof 12_jenny",
      "edition": "MVP",
      "replaces": "skill",
      "tradeoff": "Jenny MVP deixa de ser apenas aceleradora de Influence e passa a proteger a lane que escolheu apoiar.",
      "action": {
        "name": "MVP Tempo",
        "text": "+2 Influence na própria lane e bloqueia Challenge nessa lane nesta rodada. Rear apenas.",
        "effect": "fortify",
        "amount": 2,
        "rows": [
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-alice-westland",
      "playerKey": "asgard_alice westland",
      "edition": "FINALS",
      "replaces": "skill",
      "tradeoff": "Alice troca alcance de suporte por segurança de final: menos pressão, mais proteção contra Challenge.",
      "action": {
        "name": "Final Cover",
        "text": "+1 Influence na própria lane e bloqueia Challenge nessa lane nesta rodada. Rear apenas.",
        "effect": "fortify",
        "amount": 1,
        "rows": [
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-tarruh",
      "playerKey": "asgard_tarruh",
      "edition": "FINALS",
      "replaces": "skill",
      "tradeoff": "Tarruh abre mão da proteção da Skill base para buscar uma virada de Influence imediata.",
      "action": {
        "name": "All-In de Final",
        "text": "+3 Influence na própria lane nesta rodada, mas não bloqueia Challenge.",
        "effect": "boost_lane",
        "amount": 3,
        "rows": [
          "front",
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-tayna-lannister-muller",
      "playerKey": "asgard_tayna lannister muller",
      "edition": "FINALS",
      "replaces": "skill",
      "tradeoff": "Tayná reduz menos Influence bruto, mas passa a cortar suporte e controlar a estrutura da lane.",
      "action": {
        "name": "Fechamento de Final",
        "text": "-1 Influence inimigo e anula Assist inimigo na própria lane nesta rodada.",
        "effect": "lockdown",
        "amount": 1,
        "rows": [
          "front",
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-ran-yuki",
      "playerKey": "kof 12_ran yuki",
      "edition": "CHAMPION",
      "replaces": "signature",
      "tradeoff": "Ran Yuki concentra a Signature em um duelo decisivo e abandona qualquer alcance fora da própria lane.",
      "action": {
        "name": "Champion Point",
        "text": "+4 Influence na própria lane e anula Assist inimigo dessa lane nesta rodada.",
        "effect": "duel_lane",
        "amount": 4,
        "rows": [
          "front"
        ]
      }
    },
    {
      "agentId": "agent-shirakami-niku",
      "playerKey": "kof 12_shirakami niku",
      "edition": "CHAMPION",
      "replaces": "signature",
      "tradeoff": "Shirakami Niku transforma a Signature em uma fortaleza local; continua sem resolver outras lanes.",
      "action": {
        "name": "Trono Inabalável",
        "text": "+4 Influence na própria lane e todos os Challenges inimigos dessa lane são bloqueados.",
        "effect": "bastion",
        "amount": 4,
        "rows": [
          "front",
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-wei-wang",
      "playerKey": "rainbow six_wei wang",
      "edition": "MVP",
      "replaces": "signature",
      "tradeoff": "Wei Wang MVP concentra todo o valor em negar uma lane crítica, em vez de espalhar pressão.",
      "action": {
        "name": "MVP Lock",
        "text": "-3 Influence inimigo e anula Assist inimigo na própria lane nesta rodada.",
        "effect": "lockdown",
        "amount": 3,
        "rows": [
          "front",
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-mik-kashnov",
      "playerKey": "morning star_mik kashnov",
      "edition": "ICON",
      "replaces": "skill",
      "tradeoff": "Mik troca reforço direto por leitura e negação; a força premium vem do conjunto ICON + rarity/Holo real da carta.",
      "action": {
        "name": "Ícone de Campo",
        "text": "-1 Influence inimigo e anula Assist inimigo na própria lane nesta rodada. Rear apenas.",
        "effect": "lockdown",
        "amount": 1,
        "rows": [
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-ryan-smith",
      "playerKey": "morning star_ryan smith",
      "edition": "CHAMPION",
      "replaces": "signature",
      "tradeoff": "Ryan troca controle concentrado por uma Signature de comando global que exige boa formação de Fronts.",
      "action": {
        "name": "Comando de Campeão",
        "text": "+2 Influence em cada lane que possua um aliado na Front.",
        "effect": "network",
        "amount": 2,
        "rows": [
          "front",
          "rear"
        ]
      }
    },
    {
      "agentId": "agent-saki",
      "playerKey": "morning star_saki",
      "edition": "CHAMPION",
      "replaces": "signature",
      "tradeoff": "Saki ganha uma janela de Break mais ameaçadora, mas continua dependente de uma Front inimiga sem proteção.",
      "action": {
        "name": "Golpe do Título",
        "text": "-3 Influence inimigo na lane. Se a Front não estiver protegida, ela entra em Recovery na próxima rodada.",
        "effect": "shatter",
        "amount": 3,
        "rows": [
          "front"
        ]
      }
    }
  ]
};
