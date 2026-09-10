import React from 'react';
import type { MatchController } from '../../game/controller';
import { useMatch } from '../matchStore';
import { registry } from '../../engine/registry';
import { allCardsSorted } from './CardView';
import { charactersInPlay, player } from '../../engine/queries';
import { STATUSES } from '../../data/statuses';

/** Painel de debug — disponível apenas em modo desenvolvedor. */
export const DebugPanel: React.FC<{ controller: MatchController }> = ({ controller }) => {
  const show = useMatch((s) => s.showDebug);
  const toggle = useMatch((s) => s.toggleDebug);
  const st = controller.engine.state;
  const [tab, setTab] = React.useState<'cards' | 'chars' | 'state'>('cards');
  const [amount, setAmount] = React.useState(1);
  const [statusId, setStatusId] = React.useState('poison');

  if (!show) return null;
  const me = player(st, 0);
  const dbg = (op: string, payload: Record<string, unknown> = {}) => {
    controller.engine.debugCommand(op, { player: 0, ...payload });
    useMatch.getState().sync(controller.engine.version, controller.engine.state, controller.engine.legalActions(0), controller.engine.getPending());
  };

  return (
    <div className="debug-panel">
      <div className="debug-head">
        <b>🛠 Debug</b>
        <button className="close-btn" onClick={toggle}>✕</button>
      </div>
      <div className="debug-tabs">
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>Cartas</button>
        <button className={tab === 'chars' ? 'on' : ''} onClick={() => setTab('chars')}>Personagens</button>
        <button className={tab === 'state' ? 'on' : ''} onClick={() => setTab('state')}>Estado</button>
      </div>
      {tab === 'cards' && (
        <div className="debug-body">
          <label>Qtd <input type="number" min={1} max={5} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
          <button onClick={() => dbg('draw', { amount })}>Comprar {amount}</button>
          <div className="debug-grid">
            {allCardsSorted().map((def) => (
              <button key={def.id} title={def.name} onClick={() => { for (let i = 0; i < amount; i++) dbg('addCardToHand', { defId: def.id }); }}>
                {def.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'chars' && (
        <div className="debug-body">
          <label>Status
            <select value={statusId} onChange={(e) => setStatusId(e.target.value)}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
            </select>
          </label>
          {[...charactersInPlay(st, 0), ...charactersInPlay(st, 1)].map((c) => (
            <div key={c.uid} className="debug-char">
              <b>{c.defId}</b> <span>({c.owner === 0 ? 'você' : 'IA'}) dano {c.damage}</span>
              <div className="debug-actions">
                <button onClick={() => dbg('damage', { targetUid: c.uid, amount: 20 })}>−20</button>
                <button onClick={() => dbg('heal', { targetUid: c.uid, amount: 20 })}>+20</button>
                <button onClick={() => dbg('applyStatus', { targetUid: c.uid, statusId, tokens: 2 })}>status</button>
                <button onClick={() => dbg('forceUpgrade', { targetUid: c.uid })}>evoluir</button>
                <button onClick={() => dbg('giveResource', { targetUid: c.uid, defId: 'res-prisma' })}>+recurso</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'state' && (
        <div className="debug-body">
          <label>PV jogador <input type="number" defaultValue={me.victoryPoints} onKeyDown={(e) => { if (e.key === 'Enter') dbg('setVp', { value: Number((e.target as HTMLInputElement).value) }); }} /></label>
          <button onClick={() => controller.send({ type: 'END_TURN', player: 0 })}>Pular turno</button>
          <button onClick={() => { controller.engine.state.triggerQueue.push({ event: 'turnStart', sourceUid: me.active?.uid ?? '', player: 0 }); }}>Disparar gatilho turnStart</button>
          <details>
            <summary>Estado bruto (JSON)</summary>
            <pre>{JSON.stringify({ ...st, log: undefined }, null, 1).slice(0, 4000)}</pre>
          </details>
          <details>
            <summary>Registro de eventos ({st.log.length})</summary>
            <pre>{st.log.slice(-60).map((e) => `${e.seq} T${e.turn} ${e.type}`).join('\n')}</pre>
          </details>
        </div>
      )}
    </div>
  );
};
