import React from 'react';
import { useApp, metaStore } from '../appStore';
import { TERMINOLOGY as T } from '../../data/terminology';

export const TitleScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  return (
    <div className="screen title-screen">
      <div className="title-art" aria-hidden>
        {Array.from({ length: 24 }).map((_, i) => <span key={i} className="spark" style={{ ['--i' as any]: i }} />)}
      </div>
      <div className="title-center">
        <h1 className="game-logo">{T.title}</h1>
        <p className="game-sub">{T.subtitle}</p>
        <button className="btn big primary" onClick={() => go('menu')}>Entrar na Liga</button>
        <p className="title-note">Agente contra agente · batalha competitiva de cartas</p>
      </div>
    </div>
  );
};

export const MenuScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const stats = metaStore.state;
  return (
    <div className="screen menu-screen">
      <h1 className="menu-logo">{T.title}</h1>
      <div className="menu-grid">
        <button className="menu-card primary" onClick={() => go('deckSelect')}>
          <span className="mc-icon">⚔</span>
          <b>Jogar</b>
          <small>Escolha um baralho e batalhe contra a IA</small>
        </button>
        <button className="menu-card" onClick={() => useApp.getState().openBuilder(null)}>
          <span className="mc-icon">🛠</span>
          <b>Construtor de Baralho</b>
          <small>Monte e edite seus baralhos</small>
        </button>
        <button className="menu-card" onClick={() => go('collection')}>
          <span className="mc-icon">🃏</span>
          <b>Coleção</b>
          <small>Explore todas as cartas</small>
        </button>
        <button className="menu-card" onClick={() => go('history')}>
          <span className="mc-icon">📊</span>
          <b>Histórico</b>
          <small>{stats.wins}V · {stats.losses}D</small>
        </button>
        <button className="menu-card" onClick={() => go('settings')}>
          <span className="mc-icon">⚙</span>
          <b>Ajustes</b>
          <small>Dificuldade, velocidade, dados</small>
        </button>
        <button className="menu-card tutorial" onClick={() => useApp.getState().startMatch({ playerDeckId: 'deck-tutorial-aluno', opponentDeckId: 'deck-tutorial-instrutor', difficulty: 'easy', seed: 777, tutorial: true, victoryTarget: 1 })}>
          <span className="mc-icon">🎓</span>
          <b>Tutorial</b>
          <small>Aprenda jogando</small>
        </button>
      </div>
    </div>
  );
};
