"use client";

// Actions only. Per-row data (picks, lock state) flows through props so
// memoised rows re-render only when their own inputs change.
import { createContext, useContext } from "react";
import type { Market, PickemGame, PickemParlay, Selection } from "@/lib/pickem";

export type PickemActions = {
  canPick: boolean;
  togglePick: (g: PickemGame, market: Market, sel: Selection) => void;
  toggleTail: (p: PickemParlay) => void;
};

export const PickemActionsContext = createContext<PickemActions>({
  canPick: false,
  togglePick: () => {},
  toggleTail: () => {},
});

export function usePickemActions() {
  return useContext(PickemActionsContext);
}
