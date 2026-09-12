import React from 'react';
import { useApp, metaStore } from '../appStore';
import { TERMINOLOGY as T } from '../../data/terminology';

export const TitleScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  return (
    <div className="screen title-screen" data-testid="title-screen">
      <div className="title-art" aria-hidden>
        {Array.from({ length: 24 }).map((_, i) => <span key={i} className="spark" style={{ ['--i' as any]: i }} />)}
      </div>
      <div className="title-center">
        <h1 className="game-logo">{T.title}</h1>
        <p className="game-sub">{T.subtitle}</p>
        <button className="btn big primary" onClick={() => go('menu')} data-testid="title-enter" autoFocus>Entrar na Liga</button>
        <p className="title-note">Agente contra agente · batalha competitiva de cartas</p>
      </div>
    </div>
  );
};

interface MenuEntry {
  testId: string;
  icon: string;
  title: string;
  subtitle: string;
  tone: 'primary' | 'online' | 'tutorial' | 'plain';
  onClick: () => void;
}

export const MenuScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const stats = metaStore.state;
  const entries: MenuEntry[] = [
    {
      testId: 'menu-play', icon: '⚔', tone: 'primary', title: 'Jogar vs IA',
      subtitle: 'Escolha um baralho e batalhe contra a inteligência artificial',
      onClick: () => go('deckSelect')
    },
    {
      testId: 'menu-multiplayer', icon: '🌐', tone: 'online', title: 'Multiplayer privado',
      subtitle: 'Crie uma sala e jogue com um amigo pelo código',
      onClick: () => go('multiplayer')
    },
    {
      testId: 'menu-ranked', icon: '👑', tone: 'online', title: 'Liga Ranqueada',
      subtitle: 'Escale de Ferro a Campeão contra os bots — e dispute o Top 10',
      onClick: () => go('ranked')
    },
    {
      testId: 'menu-tutorial', icon: '🎓', tone: 'tutorial', title: 'Tutorial',
      subtitle: stats.settings.tutorialDone ? 'Refazer o passo a passo' : 'Aprenda jogando, em 8 passos',
      onClick: () => useApp.getState().startMatch({
        playerDeckId: 'deck-tutorial-aluno', opponentDeckId: 'deck-tutorial-instrutor',
        difficulty: 'easy', seed: 777, tutorial: true, victoryTarget: 1
      })
    },
    {
      testId: 'menu-builder', icon: '🛠', tone: 'plain', title: 'Baralhos',
      subtitle: 'Monte, edite e valide seus baralhos',
      onClick: () => useApp.getState().openBuilder(null)
    },
    {
      testId: 'menu-collection', icon: '🃏', tone: 'plain', title: 'Coleção',
      subtitle: 'Explore todos os Agentes e cartas',
      onClick: () => go('collection')
    },
    {
      testId: 'menu-history', icon: '📊', tone: 'plain', title: 'Histórico',
      subtitle: `${stats.wins} vitórias · ${stats.losses} derrotas`,
      onClick: () => go('history')
    },
    {
      testId: 'menu-settings', icon: '⚙', tone: 'plain', title: 'Ajustes',
      subtitle: 'Dificuldade, som, dados locais',
      onClick: () => go('settings')
    }
  ];
  return (
    <div className="screen menu-screen" data-testid="menu-screen">
      <h1 className="menu-logo">{T.title}</h1>
      <p className="menu-sub">{T.subtitle}</p>
      <nav className="menu-grid" aria-label="Menu principal">
        {entries.map((e) => (
          <button key={e.testId} className={`menu-card ${e.tone}`} onClick={e.onClick} data-testid={e.testId}>
            <span className="mc-icon" aria-hidden>{e.icon}</span>
            <b>{e.title}</b>
            <small>{e.subtitle}</small>
          </button>
        ))}
      </nav>
      <p className="hint menu-foot">JET TCG v2 · Core Set JET · Liga Ranqueada</p>
    </div>
  );
};
