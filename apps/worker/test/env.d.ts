import type { GameRoom } from '../src/GameRoom.js';

// Type the bindings exposed by `cloudflare:test` for these worker tests.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
  }
}
