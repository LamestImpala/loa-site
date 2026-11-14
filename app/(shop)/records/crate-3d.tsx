"use client";

import { useEffect, useRef, useState } from "react";
import type { CrateItem, CrateScene } from "./crate-scene";

const SWIPE_PX = 36;

// The Crate view's bin as a three.js scene (crate-scene.ts). three.js is
// loaded here, on demand, so only shoppers who open the Crate download it.
// If the scene can't start (no WebGL), onUnavailable hands the stage back
// to the flat crate.
export default function Crate3D({
  items,
  index,
  fallCount,
  onStep,
  onPick,
  onUnavailable,
}: {
  items: CrateItem[];
  index: number;
  // Goes up each time "Down the rabbit hole" lands on a record.
  fallCount: number;
  onStep: (delta: number) => void;
  // A sleeve was tapped: its position in `items`.
  onPick: (position: number) => void;
  onUnavailable: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CrateScene | null>(null);
  const latest = useRef({ items, index, fallCount, onUnavailable });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  // Keep the scene in step with the crate's position.
  useEffect(() => {
    const fell = fallCount !== latest.current.fallCount;
    latest.current = { items, index, fallCount, onUnavailable };
    sceneRef.current?.update(items, index, fell);
  }, [items, index, fallCount, onUnavailable]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cancelled = false;
    let scene: CrateScene | null = null;
    (async () => {
      try {
        const mod = await import("./crate-scene");
        await mod.loadCrateFonts(stage);
        if (cancelled) return;
        scene = mod.createCrateScene(stage, {
          reduceMotion: false,
          onReady: () => setReady(true),
        });
        sceneRef.current = scene;
        scene.update(latest.current.items, latest.current.index, true);
      } catch {
        if (!cancelled) latest.current.onUnavailable();
      }
    })();
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="crate-stage3d"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        drag.current = null;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
          onStep(dx < 0 ? 1 : -1);
          return;
        }
        if (Math.hypot(dx, dy) > 8) return;
        const position = sceneRef.current?.pick(e.clientX, e.clientY) ?? -1;
        if (position !== -1) onPick(position);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div className="crate-backdrop" aria-hidden="true" />
      {ready ? null : <p className="crate-stage3d-note">Filling the crate…</p>}
    </div>
  );
}
