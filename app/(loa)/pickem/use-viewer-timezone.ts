"use client";

// The server renders Eastern time (where the books quote kickoffs). After
// hydration the viewer's own zone takes over; this is the one deliberate
// post-hydration re-render on the page.
import { useSyncExternalStore } from "react";
import { ET } from "@/lib/pickem-board";

const noop = () => () => {};
const local = () => Intl.DateTimeFormat().resolvedOptions().timeZone || ET;
const server = () => ET;

export function useViewerTimeZone(): string {
  return useSyncExternalStore(noop, local, server);
}
