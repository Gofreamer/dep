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
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setInspect]);
  if (!uid || !stateRef) return null;
  const inst = findInst(stateRef, uid);
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
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
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
