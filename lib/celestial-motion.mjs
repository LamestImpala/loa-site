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
  // Each sits on a printed star in the right-hand 55% of the artwork, the part
  // every shop layout shows: the desktop hero crops the left-hand sky away and
  // the phone hero sets the emblem over it. Left to right: the two stars in
  // the crescent's mouth, the pedestal finial, the star beside the rabbit and
  // the two sparkles on the armillary. [x, y, radius, seconds, delay].
  // Radii are sized to flare across the printed star beneath, and the cycles
  // are short and out of step so the sky is rarely still.
  const stars = [[845,95,9,7,-1], [861,176,18,11,-6], [1073,591,11,9,-4],
    [1248,759,14,8,-2.5], [1339,309,20,10,-8], [1394,458,17,12,-5]];
  // A four-point star: a faint wide one as the halo, a bright one over it.
  const star = (r, waist) =>
    `M 0 -${r} L ${waist} -${waist} L ${r} 0 L ${waist} ${waist} L 0 ${r} L -${waist} ${waist} L -${r} 0 L -${waist} -${waist} Z`;
  const glints = stars.map(([x,y,r,duration,delay]) =>
    `<g transform="translate(${x} ${y})"><g class="cr-celestial__twinkle" style="--glimmer-duration:${duration}s;--glimmer-delay:${delay}s">
      <path d="${star(r * 1.5, 2.6)}" fill="#ffe5ad" opacity=".3"/>
      <path d="${star(r, 1.8)}" fill="#ffe5ad"/>
      <circle r="2.4" fill="#fff6df"/></g></g>`).join('');
  // No IDs/gradient references: multiple components can coexist without SVG ID collisions.
  // The shooting star falls through the open sky between the crescent's horn
  // and the armillary, from (872, 72) to (938, 190); the travel is in the CSS.
  layer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" focusable="false">
    ${glints}<g transform="translate(872 72)"><g class="cr-celestial__meteor" fill="none" stroke-linecap="round">
      <path d="M -39.8 -71.2 L -24.2 -43.4" stroke="#cba265" stroke-width="1.4" opacity=".25"/>
      <path d="M -24.2 -43.4 L -10.1 -18.1" stroke="#e6c283" stroke-width="1.8" opacity=".55"/>
      <path d="M -10.1 -18.1 L 0 0" stroke="#ffe5ad" stroke-width="2.4"/>
      <circle r="2.8" fill="#fff2ce" stroke="none"/>
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
