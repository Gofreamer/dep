import { beforeAll, describe, expect, it } from 'vitest';
import React from 'react';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { registerJetDataPack } from '../src/data/jet/pack';
import { useApp } from '../src/ui/appStore';

/**
 * Item 38 — comportamento do front de erro, verificado sem DOM:
 * captura de erro, tela amigável (role=alert), botões de ação e cópia de
 * detalhes apenas em dev. A renderização visual real fica para o smoke manual.
 */

beforeAll(() => { registerJetDataPack(); });

function findAll(node: unknown, pred: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (pred(el)) out.push(el);
  const kids = el.props?.children;
  if (Array.isArray(kids)) for (const k of kids) findAll(k, pred, out);
  else if (kids) findAll(kids, pred, out);
  return out;
}

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError captura o erro', () => {
    const st = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(st.error?.message).toBe('boom');
  });

  it('sem erro: renderiza os filhos intactos', () => {
    const b = new ErrorBoundary({ children: <div id="kid">oi</div> });
    b.state = { error: null };
    const out = b.render() as { props: { children: unknown } };
    expect(out).toBeDefined();
    const kids = findAll(out, (el) => el.type === 'div');
    expect(kids.length).toBeGreaterThanOrEqual(1);
  });

  it('com erro: tela amigável com role=alert, Voltar ao menu e Recarregar', () => {
    const b = new ErrorBoundary({ children: <div>oi</div> });
    b.state = { error: new Error('falha simulada') };
    const out = b.render() as unknown;
    const alerts = findAll(out, (el) => el.props?.['role'] === 'alert');
    expect(alerts).toHaveLength(1);
    const texts: string[] = [];
    const collect = (node: unknown): void => {
      if (!node || typeof node !== 'object') { if (typeof node === 'string') texts.push(node); return; }
      const el = node as { props?: Record<string, unknown> };
      const kids = el.props?.children;
      if (Array.isArray(kids)) kids.forEach(collect);
      else if (kids !== undefined) collect(kids);
      else if (typeof node === 'string') texts.push(node);
    };
    collect(out);
    const flat = texts.join(' ');
    expect(flat).toContain('Voltar ao menu');
    expect(flat).toContain('Recarregar');
    expect(flat).not.toContain('falha simulada'); // detalhe técnico só em dev
  });

  it('"Voltar ao menu" limpa a partida em andamento e volta ao menu', () => {
    useApp.setState({ screen: 'match', matchConfig: { seed: 12345, playerDeckId: 'deck-jet-kof-12', opponentDeckId: 'deck-jet-asgard', difficulty: 'normal' } as never });
    const b = new ErrorBoundary({ children: null });
    b.state = { error: new Error('x') };
    b.backToMenu();
    expect(useApp.getState().screen).toBe('menu');
    expect(useApp.getState().matchConfig).toBeNull();
    // e o boundary limpa o próprio erro (children voltam)
    expect(b.state.error).toBeNull();
  });
});
