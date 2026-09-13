import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // A bateria longa (JET_LONG_TESTS=1) roda 135 partidas IA×IA em um único
    // teste; o default de 5s do vitest é insuficiente para máquinas lentas.
    testTimeout: 120_000
  }
});
