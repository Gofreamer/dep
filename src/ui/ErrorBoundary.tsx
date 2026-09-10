import React from 'react';
import { useApp } from './appStore';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

/**
 * FRONT DE ERRO (item 38): qualquer exceção de render vira uma tela amigável —
 * nunca tela branca. "Voltar ao menu" limpa a partida em andamento; os detalhes
 * técnicos ficam disponíveis para cópia apenas em build de desenvolvimento.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log para diagnóstico; a UI continua amigável.
    console.error('[JET TCG] erro de render:', error, info.componentStack);
  }

  backToMenu = (): void => {
    this.setState({ error: null });
    // Limpa qualquer partida em andamento (controller antigo morre com o unmount)
    useApp.setState({ screen: 'menu', matchConfig: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isDev = import.meta.env.DEV;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}`;
    return (
      <div className="error-boundary" role="alert" aria-live="assertive"
        style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center'
        }}>
        <h1>Algo saiu do trilho</h1>
        <p style={{ maxWidth: 480 }}>
          Ocorreu um erro inesperado, mas seu progresso salvo está intacto.
          Você pode voltar ao menu e tentar novamente.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" onClick={this.backToMenu}>Voltar ao menu</button>
          <button type="button" onClick={() => window.location.reload()}>Recarregar</button>
          {isDev && (
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(details); }}
            >
              Copiar detalhes (dev)
            </button>
          )}
        </div>
        {isDev && (
          <pre style={{ maxWidth: 720, overflow: 'auto', fontSize: 12, textAlign: 'left', opacity: 0.75 }}>
            {details}
          </pre>
        )}
      </div>
    );
  }
}
