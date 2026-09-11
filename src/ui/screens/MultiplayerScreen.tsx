import React from 'react';
import { useApp, metaStore } from '../appStore';
import { useMultiplayer } from '../../multiplayer/store';
import { inviteLink, loadSession, roomCodeFromUrl } from '../../multiplayer/client';
import { normalizeRoomCode } from '../../net/protocol';
import { JET_STARTER_DECKS } from '../../data/jet/starterDecks';
import { validateDeck } from '../../data/deckUtils';
import { DEFAULT_CONFIG } from '../../engine/types';
import { playSfx } from '../audio';

const STARTER_IDS = new Set(JET_STARTER_DECKS.map((d) => d.id));

/** Copia para a área de transferência com fallback (clipboard pode faltar). */
async function copyText(text: string, ok: (msg: string) => void): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok('Copiado!');
      return;
    }
  } catch {
    /* cai no fallback */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    ok('Copiado!');
  } catch {
    ok('Não foi possível copiar — selecione o código manualmente.');
  }
}

export const MultiplayerScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const mp = useMultiplayer();
  const [code, setCode] = React.useState(() => roomCodeFromUrl());
  const [deckId, setDeckId] = React.useState(metaStore.state.activeDeckId);
  const session = loadSession();

  React.useEffect(() => {
    useMultiplayer.getState().init();
    // Invite link: já preenche o código vindo da URL.
    const fromUrl = roomCodeFromUrl();
    if (fromUrl) setCode(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assim que a partida começa, troca de tela.
  React.useEffect(() => {
    if (mp.phase === 'playing' || mp.phase === 'over') go('onlineMatch');
  }, [mp.phase, go]);

  const decks = metaStore.listDecks();
  const inLobby = mp.phase === 'lobby' && mp.roomCode;
  const mySeat = mp.seat;
  const me = mySeat !== null ? mp.lobby?.players[mySeat] : null;
  const peer = mySeat !== null ? mp.lobby?.players[mySeat === 0 ? 1 : 0] : null;

  const submitDeck = (): void => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) {
      showToast('Escolha um baralho.');
      return;
    }
    const check = validateDeck(deck.cards, DEFAULT_CONFIG.deckRules);
    if (!check.valid) {
      showToast(check.errors[0] ?? 'Baralho inválido.');
      return;
    }
    playSfx('ui');
    if (STARTER_IDS.has(deck.id)) mp.selectDeck({ kind: 'starter', deckId: deck.id });
    else mp.selectDeck({ kind: 'custom', name: deck.name, cards: deck.cards });
  };

  return (
    <div className="screen multiplayer-screen" data-testid="multiplayer-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => { mp.leave(); go('menu'); }} data-testid="mp-back">← Voltar</button>
        <h2>Multiplayer privado</h2>
        <span className="record-badge">2 jogadores</span>
      </header>

      {!mp.configured && (
        <div className="mp-banner warn" data-testid="mp-not-configured">
          <b>Servidor multiplayer não configurado.</b>
          <span>Defina <code>VITE_MULTIPLAYER_URL</code> com o endereço do servidor de salas para jogar online. O jogo contra a IA continua funcionando normalmente.</span>
        </div>
      )}

      {mp.error && (
        <div className="mp-banner error" role="alert" data-testid="mp-error">
          <span>{mp.error}</span>
          <button className="btn ghost" onClick={mp.clearNotice}>Fechar</button>
        </div>
      )}

      {!inLobby && (
        <div className="mp-entry">
          <section className="mp-card" aria-labelledby="mp-create-title">
            <h3 id="mp-create-title">Jogar com um amigo</h3>
            <p className="hint">Crie uma sala e envie o código. Só vocês dois entram.</p>
            <button
              className="btn big primary"
              onClick={() => { playSfx('ui'); mp.createRoom(metaStore.state.settings.player1Name || 'Você'); }}
              disabled={!mp.configured}
              data-testid="mp-create"
            >
              Criar sala
            </button>
            {session && (
              <button className="btn" onClick={mp.reconnect} disabled={!mp.configured} data-testid="mp-reconnect">
                Reconectar à sala {session.roomCode}
              </button>
            )}
          </section>

          <section className="mp-card" aria-labelledby="mp-join-title">
            <h3 id="mp-join-title">Entrar numa sala</h3>
            <label className="mp-code-field">
              <span>Código da sala</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="7KQ4MX"
                maxLength={6}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                aria-label="Código da sala"
                data-testid="mp-code-input"
              />
            </label>
            <button
              className="btn big"
              onClick={() => { playSfx('ui'); mp.joinRoom(code, metaStore.state.settings.player1Name || 'Você'); }}
              disabled={!mp.configured || normalizeRoomCode(code).length !== 6}
              data-testid="mp-join"
            >
              Entrar
            </button>
            <p className="hint">Recebeu um convite? Abra o link e o código vem preenchido.</p>
          </section>
        </div>
      )}

      {inLobby && (
        <div className="mp-lobby" data-testid="mp-lobby">
          <div className="mp-room-code">
            <span className="mp-label">Código da sala</span>
            <strong className="mp-code" data-testid="mp-room-code">{mp.roomCode}</strong>
            <div className="mp-copy">
              <button className="btn" onClick={() => copyText(mp.roomCode ?? '', showToast)} data-testid="mp-copy-code">Copiar código</button>
              <button className="btn" onClick={() => copyText(inviteLink(mp.roomCode ?? ''), showToast)} data-testid="mp-copy-link">Copiar convite</button>
            </div>
            {mp.status === 'reconnecting' && <p className="mp-status" data-testid="mp-reconnecting">Reconectando…</p>}
          </div>

          <div className="mp-seats">
            {[0, 1].map((i) => {
              const p = mp.lobby?.players[i];
              const isMe = mySeat === i;
              return (
                <div key={i} className={`mp-seat ${isMe ? 'me' : ''} ${p?.present ? 'filled' : 'empty'}`} data-testid={`mp-seat-${i}`}>
                  <b>{p?.present ? p.name : 'Aguardando jogador…'}</b>
                  <span className={`mp-dot ${p?.connected ? 'on' : 'off'}`} aria-hidden />
                  <small>{p?.present ? (p.connected ? 'Conectado' : 'Desconectado') : 'Livre'}</small>
                  <small>{p?.deckName ? `Baralho: ${p.deckName}` : 'Sem baralho'}</small>
                  <small className={p?.ready ? 'ready' : ''}>{p?.ready ? 'Pronto' : 'Não pronto'}</small>
                  {isMe && <span className="mp-you">você</span>}
                </div>
              );
            })}
          </div>

          <div className="mp-deck-row">
            <label>
              Seu baralho
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)} data-testid="mp-deck-select" disabled={me?.ready}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{validateDeck(d.cards, DEFAULT_CONFIG.deckRules).valid ? '' : ' (inválido)'}</option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={submitDeck} disabled={me?.ready} data-testid="mp-deck-confirm">Usar este baralho</button>
            <button
              className={`btn ${me?.ready ? '' : 'primary'}`}
              onClick={() => { playSfx('ui'); mp.setReady(!me?.ready); }}
              disabled={!me?.deckValid}
              data-testid="mp-ready"
            >
              {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
            </button>
          </div>

          <p className="hint">
            A partida começa quando os dois jogadores estiverem presentes, com baralho válido e prontos.
            {peer && !peer.present && ' Compartilhe o código com seu amigo.'}
          </p>
          <button className="btn ghost" onClick={mp.leave} data-testid="mp-leave">Sair da sala</button>
        </div>
      )}

      {mp.configured && !inLobby && (
        <p className="hint">Modo online é para exatamente dois jogadores: você e um amigo. Sem contas, sem filas.</p>
      )}
    </div>
  );
};
