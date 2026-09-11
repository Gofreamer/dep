/**
 * Cobertura de UI executável (jsdom + Testing Library).
 *
 * Por que existe: a suíte E2E oficial é Playwright (`npm run test:e2e`), que
 * precisa de navegadores reais. Este arquivo cobre os MESMOS fluxos de produto
 * no DOM real do React e roda em qualquer ambiente (inclusive CI sem browser).
 * Não substitui o E2E visual; complementa.
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { registerJetDataPack } from '../src/data/jet/pack';
import { useApp } from '../src/ui/appStore';
import { metaStore } from '../src/persistence/store';
import { useMatch } from '../src/ui/matchStore';
import { JET_STARTER_DECKS } from '../src/data/jet/starterDecks';

beforeAll(() => {
  registerJetDataPack();
  // jsdom não implementa matchMedia (usada por consultas de mídia em JS).
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false
      })
    });
  }
  window.requestIdleCallback = ((cb: () => void) => setTimeout(cb, 0)) as never;
});

const errors: string[] = [];

function renderApp(): void {
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

beforeEach(() => {
  errors.length = 0;
  localStorage.clear();
  useApp.setState({ screen: 'title', matchConfig: null, lastOutcome: null, toast: null, editingDeckId: null });
  metaStore.resetAll();
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Entra no menu a partir da tela de título. */
async function gotoMenu(): Promise<void> {
  fireEvent.click(screen.getByTestId('title-enter'));
  expect(screen.getByTestId('menu-screen')).toBeTruthy();
}

describe('fluxo de produto (UI real)', () => {
  it('1) a página inicial abre sem erro e sem erro no console', async () => {
    renderApp();
    expect(screen.getByTestId('title-screen')).toBeTruthy();
    expect(errors.filter((e) => !e.includes('Not implemented'))).toEqual([]);
  });

  it('3) o menu final apresenta as 7 entradas em PT-BR', async () => {
    renderApp();
    await gotoMenu();
    const labels = ['Jogar vs IA', 'Multiplayer privado', 'Tutorial', 'Baralhos', 'Coleção', 'Histórico', 'Ajustes'];
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
    // nenhum botão de debug na experiência padrão
    expect(screen.queryByText(/debug/i)).toBeNull();
  });

  it('6/7) seleção de baralho mostra os 3 starters e inicia a partida', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-play'));
    expect(screen.getByTestId('deck-select-screen')).toBeTruthy();
    for (const deck of JET_STARTER_DECKS) {
      expect(screen.getByTestId(`deck-option-${deck.id}`)).toBeTruthy();
      // nome aparece no cartão E no seletor de oponente
      expect(screen.getAllByText(deck.name).length).toBeGreaterThanOrEqual(1);
    }
    fireEvent.click(screen.getByTestId('deck-start'));
    await waitFor(() => expect(screen.getByTestId('match-screen')).toBeTruthy());
    // preparação: mão visível e botão Pronto disponível após escolher ativo
    expect(screen.getByTestId('hand').children.length).toBeGreaterThan(0);
  });

  it('10/11) partida chega ao board com arte de agente e mão funcional', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-play'));
    fireEvent.click(screen.getByTestId('deck-start'));
    await waitFor(() => expect(screen.getByTestId('match-screen')).toBeTruthy());
    // artes: oficial (<img>) ou procedural (<svg>) — nunca vazio
    const hand = screen.getByTestId('hand');
    expect(hand.querySelectorAll('img, svg').length).toBeGreaterThan(0);
    // carta da mão é inspecionável via teclado/click
    const firstCard = hand.querySelector<HTMLElement>('[role="button"]');
    expect(firstCard).toBeTruthy();
  });

  it('12/17) inspecionar carta abre modal e Escape fecha', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-play'));
    fireEvent.click(screen.getByTestId('deck-start'));
    await waitFor(() => expect(screen.getByTestId('match-screen')).toBeTruthy());
    const hand = screen.getByTestId('hand');
    // Na preparação só Agentes Base são jogáveis: uma carta "dim" (não
    // utilizável agora) abre a inspeção ao ser ativada por teclado.
    const card = hand.querySelector<HTMLElement>('.card-mini.dim[role="button"]')!;
    expect(card).toBeTruthy();
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('inspect-modal')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('inspect-modal')).toBeNull());
    // REGRESSÃO: o overlay de pausa também ouvia Escape no window, então fechar
    // a inspeção ABRIA a pausa e deixava um .modal-backdrop cobrindo a partida
    // (achado pelo E2E em Chromium). O modal mais acima deve consumir o Escape.
    expect(screen.queryByTestId('pause-modal')).toBeNull();
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  it('15) botão Encerrar Turno existe e fica habilitado só no seu turno', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-play'));
    fireEvent.click(screen.getByTestId('deck-start'));
    await waitFor(() => expect(screen.getByTestId('match-screen')).toBeTruthy());
    // preparação: "Pronto" aparece depois de escolher o ativo
    const hand = screen.getByTestId('hand');
    const chars = [...hand.querySelectorAll<HTMLElement>('[role="button"]')];
    for (const el of chars) {
      fireEvent.click(el);
      if (screen.queryByTestId('setup-done')) break;
    }
    expect(screen.getByTestId('setup-done')).toBeTruthy();
    fireEvent.click(screen.getByTestId('setup-done'));
    // A IA termina a própria preparação em ticks assíncronos (550ms).
    await waitFor(() => expect(screen.getByTestId('turn-banner')).toBeTruthy(), { timeout: 9000 });
    // "Encerrar Turno" só existe fora da preparação; a IA também prepara.
    await waitFor(() => expect(screen.getByTestId('end-turn')).toBeTruthy(), { timeout: 9000 });
    const endTurn = screen.getByTestId('end-turn') as HTMLButtonElement;
    const st = useMatch.getState().stateRef!;
    // habilitado SOMENTE no seu turno (legalActions como fonte da verdade)
    expect(endTurn.disabled).toBe(st.activePlayer !== 0);
  }, 25000);

  it('3/4/5) tutorial abre, entra na partida e responde ao fluxo guiado', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-tutorial'));
    await waitFor(() => expect(screen.getByTestId('match-screen')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('tutorial-banner')).toBeTruthy());
    expect(screen.getByTestId('tutorial-banner').textContent).toContain('Escolha seu Ativo');
    // passo 1: Jenny como ativo
    const jenny = screen.getByTestId('hand').querySelector<HTMLElement>('[data-card-id="agent-jenny-base"]');
    expect(jenny).toBeTruthy();
    fireEvent.click(jenny!);
    await waitFor(() => expect(screen.getByTestId('tutorial-banner').textContent).toContain('Reserva'));
  });

  it('18/19/20) coleção abre, filtra e mostra BASE + edição', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-collection'));
    expect(screen.getByTestId('collection-screen')).toBeTruthy();
    expect(screen.getByTestId('card-agent-jenny-base')).toBeTruthy();
    // edição especial visível na coleção (composição BASE + sidegrade)
    const editions = [...screen.getAllByTestId(/^card-agent-/)];
    expect(editions.length).toBeGreaterThan(18);
    // filtro de busca
    fireEvent.change(screen.getByTestId('collection-search'), { target: { value: 'Jenny' } });
    await waitFor(() => {
      expect(screen.getByTestId('card-agent-jenny-base')).toBeTruthy();
      expect(screen.queryByTestId('card-jres-energia')).toBeNull();
    });
  });

  it('21/22/23) deck builder abre, adiciona e remove carta e valida', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-builder'));
    expect(screen.getByTestId('builder-screen')).toBeTruthy();
    const before = screen.getByTestId('builder-validity').textContent ?? '';
    fireEvent.click(screen.getByTestId('card-jres-energia'));
    await waitFor(() => {
      const after = screen.getByTestId('builder-validity').textContent ?? '';
      expect(after).not.toBe(before);
    });
    // remover pelo painel do baralho
    const deckPanel = screen.getByTestId('builder-validity').parentElement!;
    const line = within(deckPanel).getByTestId('card-jres-energia');
    fireEvent.click(line);
    await waitFor(() => {
      const after = screen.getByTestId('builder-validity').textContent ?? '';
      expect(after).toBe(before);
    });
  });

  it('24/25) salvar e reabrir baralho preserva a composição', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-builder'));
    fireEvent.change(screen.getByTestId('builder-name'), { target: { value: 'Meu Baralho de Teste' } });
    fireEvent.click(screen.getByTestId('card-jres-energia'));
    fireEvent.blur(screen.getByTestId('builder-name'));
    const deck = metaStore.listDecks().find((d) => d.name === 'Meu Baralho de Teste');
    expect(deck).toBeTruthy();
    expect(deck!.cards['jres-energia']).toBeGreaterThan(0);
    // reabrir: o baralho continua lá (salvar e voltar → selecionar baralho)
    fireEvent.click(screen.getByTestId('builder-back'));
    fireEvent.click(screen.getByTestId('menu-play'));
    expect(screen.getByTestId(`deck-option-${deck!.id}`)).toBeTruthy();
    expect(screen.getAllByText('Meu Baralho de Teste').length).toBeGreaterThan(0);
  });

  it('26) ajustes persistem entre renders', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-settings'));
    const sound = screen.getByTestId('settings-sound') as HTMLInputElement;
    expect(sound.checked).toBe(true);
    fireEvent.click(sound);
    expect(metaStore.state.settings.soundEnabled).toBe(false);
    cleanup();
    useApp.setState({ screen: 'title' });
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-settings'));
    expect((screen.getByTestId('settings-sound') as HTMLInputElement).checked).toBe(false);
  });

  it('27) histórico abre e mostra o estado vazio', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-history'));
    expect(screen.getByTestId('history-screen')).toBeTruthy();
    expect(screen.getByText(/Nenhuma partida ainda/)).toBeTruthy();
  });

  it('28/29) resultado de partida e revanche criam nova partida', async () => {
    renderApp();
    act(() => {
      useApp.getState().startMatch({ playerDeckId: JET_STARTER_DECKS[0].id, opponentDeckId: JET_STARTER_DECKS[1].id, difficulty: 'easy', seed: 42 });
      useApp.getState().finishMatch('win');
    });
    expect(screen.getByTestId('results-screen')).toBeTruthy();
    expect(screen.getByText('Vitória!')).toBeTruthy();
    const seedBefore = useApp.getState().matchConfig!.seed;
    fireEvent.click(screen.getByTestId('results-rematch'));
    expect(useApp.getState().screen).toBe('match');
    expect(useApp.getState().matchConfig!.seed).not.toBe(seedBefore);
  });

  it('30) voltar para o menu a partir do resultado', async () => {
    renderApp();
    act(() => {
      useApp.getState().startMatch({ playerDeckId: JET_STARTER_DECKS[0].id, opponentDeckId: JET_STARTER_DECKS[1].id, difficulty: 'easy', seed: 7 });
      useApp.getState().finishMatch('loss');
    });
    expect(screen.getByText('Derrota…')).toBeTruthy();
    fireEvent.click(screen.getByTestId('results-menu'));
    expect(screen.getByTestId('menu-screen')).toBeTruthy();
  });

  it('trocar baralho a partir do resultado leva à seleção', async () => {
    renderApp();
    act(() => {
      useApp.getState().startMatch({ playerDeckId: JET_STARTER_DECKS[0].id, opponentDeckId: JET_STARTER_DECKS[1].id, difficulty: 'easy', seed: 7 });
      useApp.getState().finishMatch('win');
    });
    fireEvent.click(screen.getByTestId('results-change-deck'));
    expect(screen.getByTestId('deck-select-screen')).toBeTruthy();
  });

  it('ErrorBoundary nunca deixa tela branca e limpa a partida ao voltar ao menu', async () => {
    const Boom: React.FC = () => {
      throw new Error('falha de teste');
    };
    act(() => { useApp.setState({ screen: 'match' }); });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    // nunca tela branca: existe conteúdo acessível
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Algo saiu do trilho')).toBeTruthy();
    fireEvent.click(screen.getByText('Voltar ao menu'));
    // a ação limpa a partida em andamento (cobertura completa do ciclo de
    // recuperação está em tests/jet-error-boundary.test.tsx)
    expect(useApp.getState().screen).toBe('menu');
    expect(useApp.getState().matchConfig).toBeNull();
  });
});

describe('multiplayer privado (UI)', () => {
  it('abre a tela e avisa quando o servidor não está configurado', async () => {
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-multiplayer'));
    expect(screen.getByTestId('multiplayer-screen')).toBeTruthy();
    expect(screen.getByTestId('mp-create')).toBeTruthy();
    expect(screen.getByTestId('mp-join')).toBeTruthy();
    // sem VITE_MULTIPLAYER_URL: banner claro, jogo contra IA intacto
    expect(screen.getByTestId('mp-not-configured')).toBeTruthy();
    expect((screen.getByTestId('mp-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('preenche o código vindo do invite link (?room=)', async () => {
    window.history.pushState({}, '', '/?room=jt4mq7');
    renderApp();
    await gotoMenu();
    fireEvent.click(screen.getByTestId('menu-multiplayer'));
    await waitFor(() => {
      expect((screen.getByTestId('mp-code-input') as HTMLInputElement).value).toBe('JT4MQ7');
    });
    window.history.pushState({}, '', '/');
  });
});
