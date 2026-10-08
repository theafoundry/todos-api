import { createContext } from "react";

/** Optional carousel coordination; standalone desktop cards keep their own state. */
export const CardInteractionContext = createContext<{
  active: boolean;
  onFlipChange: (flipped: boolean) => void;
} | null>(null);
