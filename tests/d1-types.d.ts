/**
 * SOMENTE para o typecheck do projeto raiz (`npm run typecheck`).
 *
 * `tests/jet-d1-migrations.test.ts` importa `worker/src/d1repo.ts` de verdade —
 * é assim que o SQL do repositório é exercitado contra o esquema das migrations
 * num SQLite real. O tipo `D1Database` vem de `@cloudflare/workers-types`, que só
 * é incluído em `worker/tsconfig.json`; puxar os types do Worker para o programa
 * do app faria-os colidir com a lib DOM. Então declaramos aqui a forma mínima
 * (estrutura, não comportamento) que o repositório usa.
 *
 * O Worker continua typechecked contra os tipos oficiais: `npm run typecheck:worker`.
 */
interface D1Result<T = unknown> {
  results: T[];
  success?: boolean;
  error?: string;
  meta?: unknown;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
