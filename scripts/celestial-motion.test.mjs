import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCelestialMotion, coverGeometry } from '../lib/celestial-motion.mjs';

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, event = {}) { this.listeners.get(name)?.forEach(callback => callback(event)); }
}
function fixture({ reduced = false, stored = null, storageFails = false } = {}) {
  const button = Object.assign(new Events(), { hidden: true, attributes: {}, setAttribute(k,v) { this.attributes[k] = v; } });
  const preference = Object.assign(new Events(), { matches: reduced });
  let observe;
  const win = Object.assign(new Events(), {
    matchMedia: () => preference,
    localStorage: {
      getItem() { if (storageFails) throw Error('Unavailable'); return stored; },
      setItem(k, value) { if (storageFails) throw Error('Unavailable'); stored = value; },
    },
    IntersectionObserver: class {
      constructor(callback) { observe = callback; }
      observe() {}
      disconnect() { observe = null; }
    },
  });
  const doc = Object.assign(new Events(), { defaultView: win, hidden: false });
  const root = { ownerDocument: doc, dataset: {}, querySelector: selector => selector === '[data-motion-toggle]' ? button : null };
  const cleanup = mountCelestialMotion(root);
  return { root, button, doc, win, preference, cleanup,
    visible(value) { observe?.([{ target: root, isIntersecting: value }]); },
    stored: () => stored };
}
test('manual pause survives visibility changes and is remembered on remount', () => {
  const f = fixture();
  f.visible(true);
  assert.equal(f.root.dataset.motion, 'running');
  f.button.emit('click');
  assert.equal(f.root.dataset.motion, 'paused');
  assert.equal(f.button.textContent, 'Resume motion');
  f.visible(false); f.visible(true);
  f.doc.hidden = true; f.doc.emit('visibilitychange');
  f.doc.hidden = false; f.doc.emit('visibilitychange');
  assert.equal(f.root.dataset.motion, 'paused');
  const again = fixture({ stored: f.stored() });
  again.visible(true);
  assert.equal(again.root.dataset.motion, 'paused');
  again.button.emit('click');
  assert.equal(again.root.dataset.motion, 'running');
  f.cleanup(); again.cleanup();
});
test('reduced motion disables autoplay and the resume button, including live changes', () => {
  const f = fixture({ reduced: true });
  f.visible(true);
  assert.equal(f.root.dataset.motion, 'paused');
  assert.equal(f.button.disabled, true);
  f.button.emit('click');
  assert.equal(f.root.dataset.motion, 'paused');
  f.preference.matches = false; f.preference.emit('change');
  assert.equal(f.root.dataset.motion, 'running');
  f.button.emit('click');
  f.preference.matches = true; f.preference.emit('change');
  f.preference.matches = false; f.preference.emit('change');
  assert.equal(f.root.dataset.motion, 'paused', 'manual pause must survive system changes');
  f.cleanup();
});
test('offscreen and hidden-tab suspension resume only when both conditions allow it', () => {
  const f = fixture();
  assert.equal(f.root.dataset.motion, 'paused');
  f.visible(true);
  assert.equal(f.root.dataset.motion, 'running');
  f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.equal(f.root.dataset.motion, 'paused');
  f.visible(false);
  f.doc.hidden = false; f.doc.emit('visibilitychange');
  assert.equal(f.root.dataset.motion, 'paused');
  f.visible(true);
  assert.equal(f.root.dataset.motion, 'running');
  f.cleanup();
});
test('unavailable storage does not break playback or pausing', () => {
  const f = fixture({ storageFails: true });
  f.visible(true);
  assert.equal(f.root.dataset.motion, 'running');
  f.button.emit('click');
  assert.equal(f.root.dataset.motion, 'paused');
  f.cleanup();
});
test('cleanup removes listeners and stops animation', () => {
  const f = fixture();
  f.visible(true);
  f.cleanup();
  f.button.emit('click');
  f.preference.emit('change');
  f.doc.emit('visibilitychange');
  assert.equal(f.root.dataset.motion, 'paused');
  assert.equal(f.button.hidden, true);
  for (const target of [f.button, f.preference, f.doc, f.win]) {
    for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
  }
});
test('cross-tab preference changes synchronize without overriding reduced motion', () => {
  const f = fixture(); f.visible(true);
  f.win.emit('storage', { key: 'curiouser-celestial-paused', newValue: 'true' });
  assert.equal(f.root.dataset.motion, 'paused');
  f.preference.matches = true; f.preference.emit('change');
  f.win.emit('storage', { key: 'curiouser-celestial-paused', newValue: 'false' });
  assert.equal(f.root.dataset.motion, 'paused');
  f.cleanup();
});
test('star coordinates follow tall desktop and landscape mobile cover crops', () => {
  const desktop = coverGeometry(800, 700, 1536, 1024, .95, .5);
  assert.deepEqual(desktop, { width: 1050, height: 700, left: -237.5, top: 0 });
  const wide = coverGeometry(900, 400, 1536, 1024, .5, .5);
  assert.deepEqual(wide, { width: 900, height: 600, left: 0, top: -100 });
});
