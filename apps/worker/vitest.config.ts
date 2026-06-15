import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * Runs the GameRoom Durable Object inside the real Workers runtime (workerd).
 *
 * We configure miniflare inline rather than pointing at wrangler.toml on purpose:
 * the production config has an `[assets]` binding pointing at ../web/dist, which
 * isn't built in the CI unit-test job. These tests drive the Durable Object
 * directly and never touch static assets, so we declare just the DO binding.
 */
export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        main: './src/index.ts',
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2024-11-01',
          // Required by @cloudflare/vitest-pool-workers' harness. Affects only the
          // test runtime — production (wrangler.toml) deliberately omits it.
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: {
            GAME_ROOM: { className: 'GameRoom', useSQLite: true },
          },
        },
      },
    },
  },
});
