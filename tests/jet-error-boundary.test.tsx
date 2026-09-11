// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { registerJetDataPack } from '../src/data/jet/pack';
import { useApp } from '../src/ui/appStore';

/**
 * Item 38 — comportamento do front de erro.
 *
 * NOTA DE RELEASE: este arquivo existia mas NUNCA foi executado — o `include`
 * do Vitest era `tests/**\/*.test.ts` e não cobria `.tsx`. O padrão foi
 * corrigido e os dois casos que dependiam de um componente não montado foram
 * reescritos com render real (chamar `setState` fora do ciclo de vida é no-op
 * no React 18, então a asserção antiga não verificava nada).
 */

beforeAll(() => { registerJetDataPack(); });
beforeEach(() => { shouldThrow = true; vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function findAll(node: unknown, pred: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (pred(el)) out.push(el);
  const kids = el.props?.children;
  if (Array.isArray(kids)) for (const k of kids) findAll(k, pred, out);
  else if (kids) findAll(kids, pred, out);
  return out;
}

/** Componente que falha enquanto `shouldThrow` estiver ligado. */
let shouldThrow = true;
const Boom: React.FC = () => {
  if (shouldThrow) throw new Error('falha simulada');
  return <div data-testid="restored">ok</div>;
};

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError captura o erro', () => {
    const st = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(st.error?.message).toBe('boom');
  });

  it('sem erro: renderiza os filhos intactos', () => {
    render(<ErrorBoundary><div data-testid="kid">oi</div></ErrorBoundary>);
    expect(screen.getByTestId('kid')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('com erro: tela amigável com role=alert, Voltar ao menu e Recarregar', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Algo saiu do trilho')).toBeTruthy();
    expect(screen.getByText('Voltar ao menu')).toBeTruthy();
    expect(screen.getByText('Recarregar')).toBeTruthy();
    // Detalhe técnico: presente SOMENTE em build de desenvolvimento
    // (`import.meta.env.DEV` é removido por dead-code elimination na build).
    const hasDetails = !!screen.queryByText('Copiar detalhes (dev)');
    expect(hasDetails).toBe(import.meta.env.DEV);
    if (!import.meta.env.DEV) {
      expect(document.body.textContent).not.toContain('falha simulada');
    }
  });

  it('"Voltar ao menu" limpa a partida em andamento e restaura os filhos', () => {
    useApp.setState({
      screen: 'match',
      matchConfig: { seed: 12345, playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard', difficulty: 'normal' } as never
    });
    const { rerender } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByText('Voltar ao menu'));
    expect(useApp.getState().screen).toBe('menu');
    expect(useApp.getState().matchConfig).toBeNull();
    // A causa raiz continua lançando: o boundary continua protegendo (nunca
    // tela branca) e a ação do usuário (limpar partida) foi aplicada.
    expect(screen.getByRole('alert')).toBeTruthy();
    void rerender;
    // Com a causa corrigida, uma nova montagem do boundary renderiza os filhos.
    cleanup();
    shouldThrow = false;
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('restored')).toBeTruthy();
  });

  it('árvore de erro expõe exatamente um role=alert', () => {
    const b = new ErrorBoundary({ children: <div>oi</div> });
    b.state = { error: new Error('x') };
    const alerts = findAll(b.render(), (el) => el.props?.['role'] === 'alert');
    expect(alerts).toHaveLength(1);
  });
});
