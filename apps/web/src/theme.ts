import { createContext, useContext } from 'react';
import type { Theme } from '@ek/shared';

/**
 * The active card-art theme for the current room. Provided once near the room
 * root from `view.options.theme`, so every card renderer (hand, piles, overlays,
 * prompts, help) picks up the host's choice without prop-drilling. Defaults to
 * `cats` outside a provider.
 */
export const ThemeContext = createContext<Theme>('cats');

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
