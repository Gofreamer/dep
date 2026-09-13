import React from 'react';
import { useApp } from './ui/appStore';
import { TitleScreen, MenuScreen } from './ui/screens/TitleMenu';
import { DeckSelectScreen } from './ui/screens/DeckSelectScreen';
import { DeckBuilderScreen } from './ui/screens/DeckBuilderScreen';
import { CollectionScreen, HistoryScreen, SettingsScreen, ResultsScreen } from './ui/screens/CollectionHistorySettings';
import { MatchScreen } from './ui/screens/MatchScreen';
import { MultiplayerScreen } from './ui/screens/MultiplayerScreen';
import { OnlineMatchScreen } from './ui/screens/OnlineMatchScreen';
import { RankedScreen } from './ui/screens/RankedScreen';

export default function App() {
  const screen = useApp((s) => s.screen);
  const toast = useApp((s) => s.toast);
  return (
    <div className="app">
      {screen === 'title' && <TitleScreen />}
      {screen === 'menu' && <MenuScreen />}
      {screen === 'deckSelect' && <DeckSelectScreen />}
      {screen === 'builder' && <DeckBuilderScreen />}
      {screen === 'collection' && <CollectionScreen />}
      {screen === 'match' && <MatchScreen key={useApp.getState().matchConfig?.seed} />}
      {screen === 'multiplayer' && <MultiplayerScreen />}
      {screen === 'onlineMatch' && <OnlineMatchScreen />}
      {screen === 'ranked' && <RankedScreen />}
      {screen === 'results' && <ResultsScreen />}
      {screen === 'history' && <HistoryScreen />}
      {screen === 'settings' && <SettingsScreen />}
      {toast && <div className="toast">{toast.text}</div>}
    </div>
  );
}
