import React from 'react';
import { useApp } from '../appStore';
import { useMultiplayer } from '../../multiplayer/store';
import type { CardInstance, Command, PlayerId } from '../../engine/types';
import { charDef, defOf } from '../../engine/queries';
import { registry } from '../../engine/registry';
import { TERMINOLOGY as T } from '../../data/terminology';
import { BoardCard, ZonePile, findInst } from '../components/BoardCard';
import { CardMini, CardView } from '../components/CardView';
import { REJECT_TEXTS } from '../../net/protocol';
import { playSfx } from '../audio';

/**
 * Partida online. Toda a regra vem do servidor: esta tela apenas renderiza a
 * `PublicMatchView` recebida e envia intenções (`Command`). Nada de regra
 * recriada aqui — `legalActions` vem pronto do Worker.
 */
export const OnlineMatchScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const view = useMultiplayer((s) => s.view);
  const legal = useMultiplayer((s) => s.legal);
  const pending = useMultiplayer((s) => s.pending);
  const seat = useMultiplayer((s) => s.seat);
  const phase = useMultiplayer((s) => s.phase);
  const peerConnected = useMultiplayer((s) => s.peerConnected);
  const status = useMultiplayer((s) => s.status);
  const error = useMultiplayer((s) => s.error);
  const winner = useMultiplayer((s) => s.winner);
  const rematch = useMultiplayer((s) => s.rematch);
  const sendCommand = useMultiplayer((s) => s.sendCommand);
  const resolveChoice = useMultiplayer((s) => s.resolveChoice);
  const [targeting, setTargeting] = React.useState<string | null>(null);
  const [inspect, setInspect] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspect(null);
        setTargeting(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (phase === 'idle' || seat === null) {
    return (
      <div className="screen online-match">
        <div className="loading">Sala encerrada.</div>
        <button className="btn" onClick={() => go('multiplayer')}>Voltar ao multiplayer</button>
      </div>
    );
  }

  if (!view || !legal) {
    return <div className="screen online-match"><div className="loading">Preparando a arena online…</div></div>;
  }

  const me = view.players[seat];
  const opp = view.players[seat === 0 ? 1 : 0];
  const oppIdx: PlayerId = seat === 0 ? 1 : 0;
  const setupMode = view.phase === 'setup';
  const myTurn = view.activePlayer === seat && !setupMode;
  const vpTarget = view.config.victory.targetPoints;

  const send = (cmd: Command): void => {
    if (cmd.player !== seat) return;
    playSfx('ui');
    sendCommand(cmd);
  };

  // ---- alvos ---------------------------------------------------------------
  const candidates = new Set<string>(pending?.candidates ?? []);
  let attachTargets = new Set<string>();
  if (targeting) {
    const card = me.hand.find((c) => c.uid === targeting);
    if (card?.kind === 'EQUIPMENT') attachTargets = new Set(legal.playableEquipment.find((e) => e.uid === targeting)?.targets ?? []);
    else if (card?.kind === 'RESOURCE') attachTargets = new Set([...me.bench.map((c) => c.uid), ...(me.active ? [me.active.uid] : [])]);
    else if (card?.kind === 'CHARACTER') attachTargets = new Set(legal.upgradable.filter((u) => u.to === targeting).map((u) => u.from));
  }
  const highlight = new Set<string>([...candidates, ...attachTargets]);
  const setupTargets = new Set(setupMode && !me.setupDone ? [...legal.setupActive] : []);
  const targetMode: 'pending' | 'attach' | null = pending ? 'pending' : targeting ? 'attach' : null;

  const clickHand = (card: CardInstance): void => {
    if (setupMode) {
      if (setupTargets.has(card.uid)) {
        if (!me.active) send({ type: 'SETUP_SET_ACTIVE', player: seat, uid: card.uid });
        else send({ type: 'SETUP_BENCH', player: seat, uid: card.uid });
      }
      return;
    }
    const info = legal.hand[card.uid];
    if (!info?.playable) {
      if (info?.reason) showToast(T.errorTexts[info.reason] ?? REJECT_TEXTS.illegal);
      setInspect(card.uid);
      return;
    }
    switch (card.kind) {
      case 'CHARACTER': {
        const ups = legal.upgradable.filter((u) => u.to === card.uid);
        if (ups.length === 1) {
          send({ type: 'UPGRADE', player: seat, uid: card.uid, targetUid: ups[0].from });
          return;
        }
        send({ type: 'DEPLOY_CHARACTER', player: seat, uid: card.uid });
        break;
      }
      case 'RESOURCE':
      case 'EQUIPMENT':
        setTargeting(card.uid);
        break;
      case 'ACTION':
        send({ type: 'PLAY_ACTION', player: seat, uid: card.uid });
        break;
      case 'FIELD':
        send({ type: 'PLAY_FIELD', player: seat, uid: card.uid });
        break;
      default:
        break;
    }
  };

  const clickBoard = (inst: CardInstance, owner: PlayerId): void => {
    if (setupMode) {
      if (owner === seat && setupTargets.has(inst.uid)) {
        if (!me.active) send({ type: 'SETUP_SET_ACTIVE', player: seat, uid: inst.uid });
        else send({ type: 'SETUP_BENCH', player: seat, uid: inst.uid });
      }
      return;
    }
    if (targetMode === 'pending' && highlight.has(inst.uid)) {
      resolveChoice([inst.uid]);
      setTargeting(null);
      return;
    }
    if (targetMode === 'attach' && owner === seat && highlight.has(inst.uid)) {
      const card = me.hand.find((c) => c.uid === targeting)!;
      if (card.kind === 'RESOURCE') send({ type: 'ATTACH_RESOURCE', player: seat, uid: card.uid, targetUid: inst.uid });
      else if (card.kind === 'EQUIPMENT') send({ type: 'PLAY_EQUIPMENT', player: seat, uid: card.uid, targetUid: inst.uid });
      else if (card.kind === 'CHARACTER') send({ type: 'UPGRADE', player: seat, uid: card.uid, targetUid: inst.uid });
      setTargeting(null);
      return;
    }
    setInspect(inst.uid);
  };

  const renderChar = (inst: CardInstance | null, owner: PlayerId, isActive: boolean): React.ReactNode => {
    if (!inst) return <div className={`slot empty ${isActive ? 'active-slot' : ''}`}>{isActive ? T.activeZoneName : ''}</div>;
    return (
      <BoardCard
        state={view}
        inst={inst}
        isActive={isActive}
        legal={owner === seat ? legal : null}
        targeting={highlight.has(inst.uid) || setupTargets.has(inst.uid)}
        onClick={() => clickBoard(inst, owner)}
      />
    );
  };

  const active = me.active;
  const attackList = active ? legal.attacks : [];
  const abilities = active ? legal.abilities.filter((a) => a.charUid === active.uid) : [];
  const retreatReady = legal.canRetreat && legal.retreatTargets.length > 0;
  const inspected = inspect ? findInst(view, inspect) : undefined;
  const iWon = winner === seat;

  return (
    <div className="screen match-screen online-match" data-testid="online-match">
      {/* oponente */}
      <div className="opp-bar">
        <ZonePile label={T.deckZoneName} count={view.hidden.deck} kind="deck" />
        <div className="opp-info">
          <span className="player-name">{opp.name} <small className="ai-tag">online</small></span>
          <div className="vp-track">{vpTrack(opp.victoryPoints, vpTarget, 'opp')}</div>
        </div>
        <div className="opp-hand-backs">
          {Array.from({ length: Math.min(view.hidden.hand, 8) }).map((_, i) => <span key={i} className="hand-back" />)}
          <span className="hand-count">×{view.hidden.hand}</span>
        </div>
        <ZonePile label={T.discardZoneName} count={opp.discard.length} kind="discard" onClick={() => setInspect(opp.discard[opp.discard.length - 1]?.uid ?? null)} />
      </div>

      <div className="field-row">
        <div className="bench-row opp-bench">
          {opp.bench.map((c) => renderChar(c, oppIdx, false))}
          {Array.from({ length: Math.max(0, view.config.board.benchSize - opp.bench.length) }).map((_, i) => <div key={i} className="slot empty mini-slot" />)}
        </div>
      </div>

      <div className="field-row active-row">
        <div className="active-zone opp-active">{renderChar(opp.active, oppIdx, true)}</div>
        <div className="center-strip">
          <div className="field-slot">
            {view.fields.length === 0 ? <span className="field-empty">{T.fieldCardName}</span> : view.fields.map((f) => (
              <button key={f.uid} className="field-card" onClick={() => setInspect(f.uid)}><span className="fc-name">🌤 {defOf(f).name}</span></button>
            ))}
          </div>
          <div className="turn-banner" data-testid="online-turn">
            {setupMode ? <span>Preparação — escolha seu {T.activeZoneName.toLowerCase()}</span>
              : view.phase === 'gameOver' ? <span>Fim de jogo</span>
                : myTurn ? <span className="my-turn">Seu turno · Turno {view.turn}</span>
                  : <span className="opp-turn">Turno de {opp.name}…</span>}
          </div>
        </div>
        <div className="active-zone my-active">{renderChar(me.active, seat, true)}</div>
      </div>

      <div className="field-row">
        <div className="bench-row my-bench">
          {me.bench.map((c) => renderChar(c, seat, false))}
          {Array.from({ length: Math.max(0, view.config.board.benchSize - me.bench.length) }).map((_, i) => <div key={i} className="slot empty mini-slot" />)}
        </div>
      </div>

      <div className="my-bar">
        <ZonePile label={T.deckZoneName} count={me.deck.length} kind="deck" />
        <div className="my-info">
          <span className="player-name">{me.name}</span>
          <div className="vp-track">{vpTrack(me.victoryPoints, vpTarget, 'me')}</div>
        </div>
        <div className="command-dock">
          {!setupMode && attackList.map((atk) => {
            const def = active ? charDef(active).attacks.find((a) => a.id === atk.attackId) : null;
            if (!def) return null;
            return (
              <button key={atk.attackId} className={`dock-btn attack-btn ${atk.playable ? 'playable' : ''}`} disabled={!atk.playable}
                title={atk.playable ? def.text ?? def.name : T.errorTexts[atk.reason ?? 'cannot_attack']}
                onClick={() => send({ type: 'ATTACK', player: seat, attackId: atk.attackId })}
                data-testid={`online-attack-${atk.attackId}`}>
                ⚔ {def.name} <b>{def.damage ?? ''}</b>
              </button>
            );
          })}
          {!setupMode && abilities.map((ab) => {
            const abDef = active ? charDef(active).abilities.find((x) => x.id === ab.abilityId) : null;
            if (!abDef) return null;
            return (
              <button key={ab.abilityId} className={`dock-btn ability-btn ${ab.playable ? 'playable' : ''}`} disabled={!ab.playable}
                title={abDef.text ?? abDef.name} onClick={() => send({ type: 'USE_ABILITY', player: seat, charUid: ab.charUid, abilityId: ab.abilityId })}>
                ✧ {abDef.name}
              </button>
            );
          })}
          {!setupMode && retreatReady && (
            <button className="dock-btn retreat-btn playable" title="Pague o custo de recuo e troque o ativo"
              onClick={() => send({ type: 'RETREAT', player: seat, benchUid: legal.retreatTargets[0] })}>
              ⇄ {T.retreatName}
            </button>
          )}
          {!setupMode && (
            <button className={`dock-btn endturn-btn ${myTurn ? 'playable' : ''}`} disabled={!myTurn}
              onClick={() => send({ type: 'END_TURN', player: seat })} data-testid="online-endturn">
              Encerrar Turno
            </button>
          )}
          {setupMode && me.active && !me.setupDone && (
            <button className="dock-btn endturn-btn playable" onClick={() => send({ type: 'SETUP_DONE', player: seat })} data-testid="online-setup-done">Pronto</button>
          )}
          <button className="dock-btn" onClick={() => useMultiplayer.getState().concede()} title="Conceder a partida" data-testid="online-concede">Conceder</button>
        </div>
        <ZonePile label={T.discardZoneName} count={me.discard.length} kind="discard" onClick={() => setInspect(me.discard[me.discard.length - 1]?.uid ?? null)} />
      </div>

      <div className="hand" data-testid="online-hand">
        {me.hand.map((card) => {
          const info = legal.hand[card.uid];
          const usable = setupMode ? legal.setupActive.includes(card.uid) || legal.setupBench.includes(card.uid) : !!info?.playable;
          return (
            <CardMini
              key={card.uid}
              def={defOf(card)}
              playable={usable}
              dim={!usable}
              onClick={() => clickHand(card)}
              onInspect={() => setInspect(card.uid)}
            />
          );
        })}
      </div>

      {targetMode && (
        <div className="target-banner" role="status">
          {targetMode === 'pending' ? `🎯 ${pending?.prompt}` : '🎯 Escolha um dos seus Agentes'}
          <button className="cancel-target" onClick={() => setTargeting(null)}>Cancelar</button>
        </div>
      )}

      {status === 'reconnecting' && <div className="net-banner" role="status" data-testid="online-reconnecting">Reconectando…</div>}
      {!peerConnected && status === 'connected' && view.phase !== 'gameOver' && (
        <div className="net-banner warn" role="status" data-testid="online-peer-off">Oponente desconectado — aguardando reconexão.</div>
      )}
      {status === 'connected' && peerConnected && view.phase !== 'gameOver' && (
        <div className="net-banner ok" role="status" data-testid="online-connected">Conectado.</div>
      )}

      {view.phase === 'gameOver' && (
        <div className="modal-backdrop">
          <div className="modal results" role="dialog" aria-modal="true" aria-label="Resultado da partida" data-testid="online-result">
            <h2>{iWon ? 'Vitória!' : winner === 'draw' ? 'Empate' : 'Derrota…'}</h2>
            <p>{view.endReason === 'concede' ? 'A partida foi concedida.' : 'A partida terminou.'}</p>
            <div className="results-actions">
              <button className="btn big primary" onClick={() => useMultiplayer.getState().wantRematch(!rematch[seat])} data-testid="online-rematch">
                {rematch[seat] ? 'Aguardando o oponente…' : 'Revanche'}
              </button>
              <button className="btn" onClick={() => { useMultiplayer.getState().leave(); go('menu'); }} data-testid="online-exit">Sair para o menu</button>
            </div>
          </div>
        </div>
      )}

      {inspected && (
        <div className="modal-backdrop" onClick={() => setInspect(null)}>
          <div className="modal inspect" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setInspect(null)} aria-label="Fechar">✕</button>
            <CardView def={defOf(inspected)} />
          </div>
        </div>
      )}
    </div>
  );
};

function vpTrack(vp: number, target: number, side: string): React.ReactNode {
  return Array.from({ length: target }).map((_, i) => (
    <span key={i} className={`vp-pip ${i < vp ? 'earned' : ''} ${side}`} title={`${T.victoryPointName} ${i + 1}/${target}`} />
  ));
}

void registry;
