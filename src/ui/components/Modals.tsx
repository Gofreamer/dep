import React from 'react';
import { useMatch } from '../matchStore';
import { findInst } from './BoardCard';
import { defOf } from '../../engine/queries';
import { CardView } from './CardView';

/** Modal de inspeção de carta (clique/toque longo). */
export const InspectModal: React.FC = () => {
  const uid = useMatch((s) => s.inspectUid);
  const setInspect = useMatch((s) => s.setInspect);
  const stateRef = useMatch((s) => s.stateRef);
  const inst = uid && stateRef ? findInst(stateRef, uid) : null;
  // O modal mais acima CONSOME o Escape. Sem isso, o listener de pausa (que
  // também ouve Escape no window) abria o menu de pausa junto: fechava a
  // inspeção e deixava um .modal-backdrop cobrindo a partida — reproduzido em
  // navegador real pelo E2E. Capture + stopPropagation impede a fase de bubble.
  React.useEffect(() => {
    if (!inst) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setInspect(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [inst, setInspect]);
  if (!inst) return null;
  const def = defOf(inst);
  return (
    <div className="modal-backdrop" onClick={() => setInspect(null)}>
      <div className="modal inspect" role="dialog" aria-modal="true" aria-label={`Detalhes de ${def.name}`} onClick={(e) => e.stopPropagation()} data-testid="inspect-modal">
        <button className="close-btn" onClick={() => setInspect(null)} aria-label="Fechar detalhes" data-testid="inspect-close">✕</button>
        <CardView def={def} />
      </div>
    </div>
  );
};

/** Visualizador de definição (construtor/coleção). */
export const DefInspectModal: React.FC<{ def: ReturnType<typeof defOf> | null; onClose: () => void }> = ({ def, onClose }) => {
  // Idem: consome o Escape na fase de capture quando está aberto.
  React.useEffect(() => {
    if (!def) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [def, onClose]);
  if (!def) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inspect" role="dialog" aria-modal="true" aria-label={`Detalhes de ${def.name}`} onClick={(e) => e.stopPropagation()} data-testid="def-inspect-modal">
        <button className="close-btn" onClick={onClose} aria-label="Fechar detalhes" data-testid="def-inspect-close">✕</button>
        <CardView def={def} />
      </div>
    </div>
  );
};
