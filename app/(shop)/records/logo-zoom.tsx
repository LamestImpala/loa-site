"use client";

/*
 * The hero emblem, clickable: opens the engraving full size in a viewer
 * where it can be zoomed (click/tap, wheel, pinch, the +/− buttons or the
 * keyboard) and panned (drag, or the arrow keys) to see the fine detail.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { onBackdropClick } from "./shop-ui";

const ALT = "Curiouser Records emblem: the White Rabbit with a record and a pocket watch";
const MAX = 5;
const TAP_ZOOM = 2.5;
const BUTTON_STEP = 1.6;
const PAN_STEP = 60;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

// The image fills a square stage at scale 1; keep its edges from coming
// inside the stage once zoomed.
function clamp(v: View, size: number): View {
  const scale = Math.min(MAX, Math.max(1, v.scale));
  const room = (size * (scale - 1)) / 2;
  const fit = (n: number) => Math.min(room, Math.max(-room, n));
  return { scale, x: fit(v.x), y: fit(v.y) };
}

// Zoom to `scale` keeping the point (px, py), measured from the stage
// centre, where it is on screen.
function zoomAt(v: View, scale: number, px: number, py: number, size: number): View {
  const next = Math.min(MAX, Math.max(1, scale));
  const k = next / v.scale;
  return clamp({ scale: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, size);
}

export function HeroLogo() {
  const [open, setOpen] = useState(false);
  return (
    // One wrapper keeps the hero grid's "emblem + next sibling" layout
    // intact; the modal dialog renders in the top layer regardless.
    <div className="shop-hero-logo">
      <button
        type="button"
        className="shop-hero-logo-zoom"
        aria-label="Enlarge the Curiouser Records emblem"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Image
          src="/images/brand/logo-360.webp"
          alt={ALT}
          width={360}
          height={360}
          priority
          sizes="180px"
        />
        <span className="shop-hero-logo-badge" aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M15 15l5 5M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <LogoViewer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function LogoViewer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: false });

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = stage!.getBoundingClientRect();
      const px = e.clientX - r.left - r.width / 2;
      const py = e.clientY - r.top - r.height / 2;
      setView((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.0025), px, py, r.width));
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open]);

  function stageBox() {
    const r = stageRef.current!.getBoundingClientRect();
    return { r, size: r.width };
  }

  function fromCentre(clientX: number, clientY: number) {
    const { r } = stageBox();
    return { px: clientX - r.left - r.width / 2, py: clientY - r.top - r.height / 2 };
  }

  function zoomBy(factor: number) {
    const { size } = stageBox();
    setView((v) => zoomAt(v, v.scale * factor, 0, 0, size));
  }

  function pan(dx: number, dy: number) {
    const { size } = stageBox();
    setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }, size));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; the gesture still works without capture.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: false };
    if (pointers.current.size === 2) gesture.current.pinch = true;
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pts = [...pointers.current.entries()];
    if (pts.length === 2) {
      const other = pts.find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const { px, py } = fromCentre((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      const { size } = stageBox();
      if (before > 0) setView((v) => zoomAt(v, v.scale * (after / before), px, py, size));
    } else if (pts.length === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (view.scale > 1) pan(dx, dy);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    setDragging(false);
    const { moved, pinch } = gesture.current;
    if (pinch || moved > 6 || e.type === "pointercancel") return;
    // A tap or click: zoom in on that spot, or back out to the whole emblem.
    if (view.scale > 1.01) {
      setView(FIT);
    } else {
      const { px, py } = fromCentre(e.clientX, e.clientY);
      const { size } = stageBox();
      setView((v) => zoomAt(v, TAP_ZOOM, px, py, size));
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const keys: Record<string, () => void> = {
      "+": () => zoomBy(BUTTON_STEP),
      "=": () => zoomBy(BUTTON_STEP),
      "-": () => zoomBy(1 / BUTTON_STEP),
      "0": () => setView(FIT),
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  }

  const zoomed = view.scale > 1.01;
  return (
    <dialog
      ref={dialogRef}
      className="shop-logo-viewer"
      aria-label="Curiouser Records emblem, enlarged"
      onClose={() => {
        setView(FIT);
        onClose();
      }}
      onClick={(e) => onBackdropClick(e, onClose)}
      onKeyDown={onKeyDown}
    >
      {open ? (
        <div className="shop-logo-viewer-body">
          <div
            ref={stageRef}
            className={`shop-logo-viewer-stage${zoomed ? " is-zoomed" : ""}${dragging ? " is-dragging" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Image
              src="/images/brand/logo-1254.webp"
              alt={ALT}
              width={1254}
              height={1254}
              unoptimized
              draggable={false}
              className="shop-logo-viewer-img"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
            />
          </div>
          <div className="shop-logo-viewer-bar">
            <span className="shop-logo-viewer-hint">
              {zoomed ? "Drag to look around · tap to zoom out" : "Tap, pinch or scroll to zoom in"}
            </span>
            <button
              type="button"
              className="shop-logo-viewer-btn"
              aria-label="Zoom out"
              disabled={!zoomed}
              onClick={() => zoomBy(1 / BUTTON_STEP)}
            >
              −
            </button>
            <button
              type="button"
              className="shop-logo-viewer-btn"
              aria-label="Zoom in"
              disabled={view.scale >= MAX - 0.01}
              onClick={() => zoomBy(BUTTON_STEP)}
            >
              +
            </button>
            <button
              type="button"
              className="shop-dialog-close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
