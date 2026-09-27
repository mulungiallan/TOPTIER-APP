// Ambient declarations for the boot-time seed scripts in /scripts.
//
// Those files are plain CommonJS excluded from the tsconfig program, so the
// instrumentation hook cannot infer their shape. Each exports `main`, which
// accepts an optional Prisma client and defaults to creating its own when run
// directly via `node scripts/<name>.js`.
declare module "*scripts/ensure-packages" {
  export function main(client?: unknown): Promise<void>;
}

declare module "*scripts/ensure-tickers" {
  export function main(client?: unknown): Promise<void>;
}

declare module "*scripts/ensure-ebooks" {
  export function main(client?: unknown): Promise<void>;
}
