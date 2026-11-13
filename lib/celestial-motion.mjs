// Map the SVG's artwork coordinates to the exact object-fit: cover crop.
export function coverGeometry(width, height, imageWidth, imageHeight, x = .5, y = .5) {
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  return { width: w, height: h, left: (width - w) * x, top: (height - h) * y };
}

function mountCelestialEffects(root) {
  const art = root.querySelector('.cr-celestial__art');
  if (!art) return () => {};
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const layer = doc.createElement('div');
  layer.className = 'cr-celestial__effects';
  layer.setAttribute('aria-hidden', 'true');
  // Coordinates on the original 1536 × 1024 illustration, not viewport positions.
  const stars = [[138,104,6,13,-4], [339,201,5,19,-12], [576,190,7,17,-11],
    [630,46,11,23,-6], [526,628,6,16,-8], [426,693,7,21,-15]];
  const glints = stars.map(([x,y,r,duration,delay]) =>
    `<g transform="translate(${x} ${y})"><g class="cr-celestial__twinkle" style="--glimmer-duration:${duration}s;--glimmer-delay:${delay}s">
      <path d="M 0 -${r} L 1.4 -1.4 L ${r} 0 L 1.4 1.4 L 0 ${r} L -1.4 1.4 L -${r} 0 L -1.4 -1.4 Z" fill="#ffe5ad"/>
      <circle r="1.7" fill="#fff6df"/></g></g>`).join('');
  // No IDs/gradient references: multiple components can coexist without SVG ID collisions.
  layer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" focusable="false">
    ${glints}<g transform="translate(490 320)"><g class="cr-celestial__meteor" fill="none" stroke-linecap="round">
      <path d="M -100 -42 L -60 -25" stroke="#cba265" stroke-width="1" opacity=".18"/>
      <path d="M -60 -25 L -26 -11" stroke="#e6c283" stroke-width="1.2" opacity=".4"/>
      <path d="M -26 -11 L 0 0" stroke="#ffe5ad" stroke-width="1.6" opacity=".85"/>
      <circle r="2" fill="#fff2ce" stroke="none"/>
    </g></g></svg>`;
  root.appendChild(layer);
  const svg = layer.querySelector('svg');
  function resize() {
    const position = win.getComputedStyle(art).objectPosition.split(/\s+/).map(parseFloat);
    const box = coverGeometry(root.clientWidth, root.clientHeight,
      art.naturalWidth || 1536, art.naturalHeight || 1024,
      Number.isFinite(position[0]) ? position[0] / 100 : .5,
      Number.isFinite(position[1]) ? position[1] / 100 : .5);
    for (const [key, value] of Object.entries(box)) svg.style[key] = `${value}px`;
  }
  const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  observer?.observe(root);
  win.addEventListener('resize', resize);
  art.addEventListener('load', resize);
  resize();
  return () => {
    observer?.disconnect();
    win.removeEventListener('resize', resize);
    art.removeEventListener('load', resize);
    layer.remove();
  };
}

/**
 * Mount one artwork controller. Safe to unmount/remount (including React Strict Mode).
 * Returns cleanup; no dependencies, global selectors, timers, or render loop.
 */
export function mountCelestialMotion(root) {
  const button = root.querySelector('[data-motion-toggle]');
  if (!button) throw new Error('Celestial artwork needs a [data-motion-toggle] button.');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const preference = win.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'curiouser-celestial-paused';
  const removeEffects = mountCelestialEffects(root);
  let paused = false;
  let inView = !win.IntersectionObserver;
  try { paused = win.localStorage.getItem(storageKey) === 'true'; } catch { /* Storage is optional. */ }

  function render() {
    const reduced = preference.matches;
    const running = !reduced && !paused && inView && !doc.hidden;
    root.dataset.motion = running ? 'running' : 'paused';
    root.dataset.motionChoice = paused ? 'paused' : 'playing';
    button.disabled = reduced;
    button.textContent = reduced ? 'Motion reduced' : paused ? 'Resume motion' : 'Pause motion';
    button.setAttribute('aria-label', reduced
      ? 'Wallpaper animation is off because your device requests reduced motion'
      : paused ? 'Resume wallpaper animation' : 'Pause wallpaper animation');
    button.hidden = false;
  }
  function toggle() {
    if (preference.matches) return;
    paused = !paused;
    try { win.localStorage.setItem(storageKey, String(paused)); } catch { /* Continue without persistence. */ }
    render();
  }
  function syncStorage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    paused = event.newValue === 'true';
    render();
  }
  const observer = win.IntersectionObserver
    ? new win.IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === root) inView = entry.isIntersecting;
      render();
    }, { threshold: 0 })
    : null;

  button.addEventListener('click', toggle);
  preference.addEventListener('change', render);
  doc.addEventListener('visibilitychange', render);
  win.addEventListener('storage', syncStorage);
  observer?.observe(root);
  render();

  return function destroy() {
    removeEffects();
    observer?.disconnect();
    button.removeEventListener('click', toggle);
    preference.removeEventListener('change', render);
    doc.removeEventListener('visibilitychange', render);
    win.removeEventListener('storage', syncStorage);
    root.dataset.motion = 'paused';
    button.hidden = true;
  };
}
