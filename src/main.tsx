import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerJetDataPack } from './data/jet/pack';

// JET CORE SET é a experiência padrão (Parte 42). O fixture NEXO permanece no
// repositório apenas para testes/dev.
registerJetDataPack();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
