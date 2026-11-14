// The 3D record bin behind the Crate view (crate-3d.tsx mounts it).
//
// A bin drawn in the shop's engraved-night style: ink boards hatched in
// antique gold, the real listing covers on the sleeves. The record you stop
// on lifts out and turns to face you, and its disc slides out in the colour
// Discogs describes for the pressing (lib/disc-style.ts).
//
// This module is the only place three.js is imported, and crate-3d.tsx loads
// it with import() so the catalog doesn't pay for it until the Crate view opens.
import * as THREE from "three";
import type { DiscStyle } from "@/lib/disc-style";

export type CrateItem = {
  id: number;
  cover: string | null; // same-origin image URL (WebGL can't read Discogs directly)
  initials: string; // drawn on a tinted sleeve when there is no cover
  sticker: string[]; // ["$82", "NM/NM"], or ["Sold"]
  sold: boolean;
  tab: string | null; // divider letter where a new one starts (A–Z sort only)
  disc: DiscStyle | null;
};

export type CrateScene = {
  // Show `items` with the one at `index` lifted. `fall` = arrived by
  // "Down the rabbit hole": the record tumbles in from above.
  update(items: CrateItem[], index: number, fall?: boolean): void;
  // Which position in `items` is under this point of the screen; -1 = none.
  pick(clientX: number, clientY: number): number;
  dispose(): void;
};

// Colours are the shop's palette hexes, used as written (no colour-space maths).
THREE.ColorManagement.enabled = false;

const INK = 0x171d30;
const INK_2 = 0x10141f;
const GOLD = 0xb48b48;
const GOLD_LIGHT = 0xe0c796;
const GOLD_DEEP = 0x785d30;
const PAPER = new THREE.Color(0xe9dfc9);

// Sleeve and bin measurements, in inches-ish.
const H = 12.3;
const T = 0.14;
const W_IN = 13.5;
const WALL = 0.45;
const FLOOR = 0.3;
const Z_FRONT = 5.4;
const Z_BACK = -9.0;
const H_FRONT = 4.6;
const H_BACK = 9.2;
const OUTER_W = W_IN + WALL * 2;
const DEPTH = Z_FRONT - Z_BACK + WALL * 2;
const Z_MID = (Z_FRONT + Z_BACK) / 2;

// How many sleeves stand behind the lifted one, how many lean flipped in front.
const BEHIND = 16;
const FLIPPED = 5;
const GAP = 0.44;
const LEAN_B = 0.17;
const LEAN_F = 0.35;
const Z_B_REST = -7.4;
const Z_F_REST = 3.75;

const CAM = { az: 0.38, el: 0.36, fov: 27, dist: 62, target: new THREE.Vector3(0.2, 10.6, -1.2) };
const HELD = { x: -1.3, y: 10.3, z: 0.9, rx: -0.3, ry: CAM.az };

const TINTS = [
  ["#ecdae0", "#582236"],
  ["#efe1c3", "#574423"],
  ["#ece4d4", "#423b4a"],
  ["#dfb4c4", "#371522"],
];
const COVER_CACHE_MAX = 80;

function hash(n: number, salt: number) {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const LINES_GLSL = `
  float lines(float c, float w) {
    float f = abs(fract(c) - 0.5);
    float aa = fwidth(c);
    float l = 1.0 - smoothstep(w - aa, w + aa, f);
    // Far away the lines are finer than a pixel: settle to their average tone.
    return mix(l, w * 2.0, smoothstep(0.25, 0.6, aa));
  }
`;

const WORLD_VERTEX = `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const DISC_FRAGMENT = `
  uniform vec4 uCol[3];
  uniform int uCount;
  uniform int uMode;
  uniform float uSeed;
  uniform float uParts;
  varying vec2 vP;
  ${LINES_GLSL}
  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 4; k++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  // Scattered blobs of varied size on a unit grid.
  float splat(vec2 g, float seed) {
    vec2 i = floor(g);
    float m = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 c = i + vec2(float(x), float(y));
        float r = h21(c + seed);
        vec2 o = vec2(h21(c + seed + 1.3), h21(c + seed + 2.7));
        float rad = 0.1 + 0.34 * r * r;
        m = max(m, smoothstep(rad, rad * 0.78, length(g - (c + o))) * step(0.42, r));
      }
    }
    return m;
  }
  void main() {
    float r = length(vP);
    float ang = atan(vP.y, vP.x);
    vec4 A = uCol[0];
    vec4 B = uCol[1];
    vec4 C = uCol[2];
    vec4 base = A;
    if (uMode == 1) {
      vec2 q = vP * 0.3 + uSeed;
      float w = fbm(q + 1.7 * vec2(fbm(q + 3.1), fbm(q + 7.7)));
      base = mix(A, B, smoothstep(0.4, 0.6, w));
      if (uCount > 2) base = mix(base, C, smoothstep(0.56, 0.7, fbm(q * 1.6 + 9.0)));
    } else if (uMode == 2) {
      float m = max(splat(vP * 0.95 + uSeed, 1.0), splat(vec2(r * 1.25, ang * 4.5) + uSeed, 5.0));
      base = mix(A, B, m);
      if (uCount > 2) base = mix(base, C, splat(vP * 1.3 - uSeed, 9.0));
    } else if (uMode == 3) {
      // Split across the middle, so both halves show on the part that slides out.
      base = mix(B, A, smoothstep(-0.04, 0.04, vP.y + vP.x * 0.12));
    } else if (uMode == 4) {
      float wob = (fbm(vec2(cos(ang), sin(ang)) * 1.6 + uSeed) - 0.5) * 1.6;
      base = mix(B, A, smoothstep(3.75 + wob, 3.4 + wob, r));
    } else if (uMode == 5) {
      float band = (vP.y / 5.85 * 0.5 + 0.5) * float(uCount);
      base = band < 1.0 ? A : (band < 2.0 ? B : C);
    } else if (uMode == 6) {
      // Pinwheel / quad pressings: wedges of alternating colour.
      float wedge = mod(floor((ang + 3.14159) / 6.28318 * uParts), float(uCount));
      base = wedge < 0.5 ? A : (wedge < 1.5 ? B : C);
    }

    vec3 col = base.rgb;
    float alpha = base.a;
    float lum = dot(col, vec3(0.3, 0.6, 0.1));
    float pressed = step(2.35, r) * step(r, 5.6);
    float groove = lines(r * 5.5, 0.11) * pressed;
    float sheen = pow(abs(cos(ang - 0.7)), 10.0);
    // Grooves read as fine dark rings on colour, and catch the light on black.
    col = mix(col, col * 0.84, groove * smoothstep(0.06, 0.25, lum));
    vec3 glint = mix(vec3(0.88, 0.76, 0.5), vec3(1.0), smoothstep(0.06, 0.3, lum));
    col += groove * (0.05 + sheen * 0.3) * glint * mix(1.0, 0.6, smoothstep(0.06, 0.3, lum));
    col += sheen * 0.035 * pressed;
    alpha = mix(alpha, 1.0, clamp(groove * 0.12 + sheen * 0.28, 0.0, 1.0) * pressed);
    // A thin rim so a clear disc still has an edge.
    alpha = mix(alpha, 1.0, smoothstep(5.74, 5.82, r) * 0.5);

    if (r < 2.15) {
      col = vec3(0.93, 0.89, 0.81);
      col = mix(col, vec3(0.71, 0.55, 0.28), lines(r * 2.6 + 0.27, 0.05));
      col = mix(col, vec3(0.49, 0.19, 0.3), step(r, 0.62) * 0.9);
      alpha = 1.0;
    }
    if (r < 0.15) col = vec3(0.03);
    gl_FragColor = vec4(col, alpha);
  }
`;

const DISC_MODES: Record<string, number> = {
  solid: 0,
  marble: 1,
  splatter: 2,
  split: 3,
  inner: 4,
  stripes: 5,
  wedges: 6,
};
const BLACK_DISC: DiscStyle = { mode: "solid", colors: [{ hex: "#0c0d12", alpha: 1 }], label: "" };

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; dim: number };
type SleeveState = Pose & { op: number; slide: number; tag: number };

// The shop's fonts are next/font families with generated names; read them
// off the stage's CSS variables and make sure they're loaded before any
// lettering is drawn to a canvas.
function stageFonts(stage: HTMLElement) {
  const css = getComputedStyle(stage);
  return {
    heading: css.getPropertyValue("--font-heading").trim() || "Georgia, serif",
    caps: css.getPropertyValue("--font-caps").trim() || "Georgia, serif",
  };
}

export async function loadCrateFonts(stage: HTMLElement) {
  const fonts = stageFonts(stage);
  await Promise.all([
    document.fonts.load(`400 40px ${fonts.heading}`),
    document.fonts.load(`400 40px ${fonts.caps}`),
  ]).catch(() => {});
}

// Throws when WebGL isn't available; the caller falls back to the flat crate.
export function createCrateScene(
  stage: HTMLElement,
  { reduceMotion, onReady }: { reduceMotion: boolean; onReady?: () => void }
): CrateScene {
  const fonts = stageFonts(stage);
  const ease = (dt: number, rate: number) => (reduceMotion ? 1 : 1 - Math.exp(-dt * rate));
  const owned: { dispose(): void }[] = []; // everything to free on dispose()
  const own = <D extends { dispose(): void }>(d: D) => {
    owned.push(d);
    return d;
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 400);
  scene.add(camera);
  const look = { az: CAM.az, el: CAM.el, dAz: 0, dEl: 0 };

  // ── engraved materials ──

  const light = new THREE.Vector3(0.45, 0.8, 0.55).normalize();

  // Ink surface shaded the way an engraver would: parallel gold lines that
  // thicken where the light falls, with cross-hatching on the brightest faces.
  function hatchMaterial(base: number, line: number, freq = 2.3, strength = 0.85) {
    return own(
      new THREE.ShaderMaterial({
        uniforms: {
          uBase: { value: new THREE.Color(base) },
          uLine: { value: new THREE.Color(line) },
          uLight: { value: light },
          uFreq: { value: freq },
          uStrength: { value: strength },
        },
        vertexShader: WORLD_VERTEX,
        fragmentShader: `
          uniform vec3 uBase;
          uniform vec3 uLine;
          uniform vec3 uLight;
          uniform float uFreq;
          uniform float uStrength;
          varying vec3 vW;
          varying vec3 vN;
          ${LINES_GLSL}
          void main() {
            vec3 n = normalize(vN);
            if (!gl_FrontFacing) n = -n;
            float light = clamp(dot(n, uLight) * 0.5 + 0.5, 0.0, 1.0);
            light = light * light * (3.0 - 2.0 * light);
            vec3 grain = normalize(vec3(0.34, 1.0, 0.28));
            vec3 d1 = normalize(grain - n * dot(grain, n));
            vec3 d2 = normalize(cross(n, d1) + d1 * 0.5);
            float a = lines(dot(vW, d1) * uFreq, mix(0.025, 0.105, light));
            float b = lines(dot(vW, d2) * uFreq * 0.9, 0.05) * smoothstep(0.78, 0.98, light);
            float ink = clamp(max(a, b * 0.8), 0.0, 1.0);
            gl_FragColor = vec4(mix(uBase, uLine, ink * uStrength), 1.0);
          }
        `,
      })
    );
  }

  function canvasTexture(
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D, w: number, h: number) => void
  ) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = maxAniso;
    return tex;
  }

  // Canvas letter-spacing is newer than the rest of the 2D API.
  function spaced(g: CanvasRenderingContext2D, px: number) {
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }

  function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const rad = k % 2 ? r * 0.22 : r;
      const ang = (k * Math.PI) / 4;
      g.lineTo(x + Math.sin(ang) * rad, y - Math.cos(ang) * rad);
    }
    g.closePath();
    g.fill();
  }

  // ── the bin ──

  const wood = hatchMaterial(INK, GOLD);
  const woodDeep = hatchMaterial(INK_2, 0x5e5560, 2.3, 0.6);
  const brass = hatchMaterial(GOLD_DEEP, GOLD_LIGHT, 5, 1);
  const outline = own(new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75 }));

  const boardFace = own(
    new THREE.MeshBasicMaterial({
      map: own(
        canvasTexture(1152, 368, (g, w, h) => {
          const grad = g.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, "#1c2339");
          grad.addColorStop(1, "#10141f");
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(180,139,72,0.22)";
          g.lineWidth = 1.6;
          for (let x = -h; x < w; x += 12) {
            g.beginPath();
            g.moveTo(x, h);
            g.lineTo(x + h, 0);
            g.stroke();
          }
          g.fillStyle = "#141a2b";
          g.fillRect(150, 92, w - 300, h - 184);
          g.strokeStyle = "#b48b48";
          g.lineWidth = 5;
          g.strokeRect(18, 18, w - 36, h - 36);
          g.lineWidth = 2;
          g.strokeRect(32, 32, w - 64, h - 64);
          g.strokeRect(150, 92, w - 300, h - 184);
          g.fillStyle = "#e0c796";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.font = `400 84px ${fonts.caps}`;
          spaced(g, 12);
          g.fillText("Curiouser Records", w / 2 + 6, h / 2 + 4);
          star(g, 92, h / 2, 26);
          star(g, w - 92, h / 2, 26);
        })
      ),
    })
  );

  const bin = new THREE.Group();
  scene.add(bin);

  function addBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material | THREE.Material[],
    edges = true
  ) {
    const geo = own(new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    if (edges) mesh.add(new THREE.LineSegments(own(new THREE.EdgesGeometry(geo)), outline));
    bin.add(mesh);
    return mesh;
  }

  addBox(OUTER_W, FLOOR, DEPTH, 0, FLOOR / 2, Z_MID, woodDeep, false);
  addBox(OUTER_W, H_FRONT, WALL, 0, H_FRONT / 2, Z_FRONT + WALL / 2, [
    wood,
    wood,
    wood,
    wood,
    boardFace,
    wood,
  ]);
  addBox(OUTER_W, H_BACK, WALL, 0, H_BACK / 2, Z_BACK - WALL / 2, wood);

  // Sides slope from the tall back board down to the low front one.
  const sideShape = new THREE.Shape();
  sideShape.moveTo(Z_BACK - WALL, 0);
  sideShape.lineTo(Z_FRONT + WALL, 0);
  sideShape.lineTo(Z_FRONT + WALL, H_FRONT);
  sideShape.lineTo(Z_BACK - WALL, H_BACK);
  sideShape.closePath();
  for (const sign of [1, -1]) {
    const geo = own(new THREE.ExtrudeGeometry(sideShape, { depth: WALL, bevelEnabled: false }));
    geo.rotateY(-Math.PI / 2);
    geo.translate(sign > 0 ? W_IN / 2 + WALL : -W_IN / 2, 0, 0);
    const side = new THREE.Mesh(geo, wood);
    side.add(new THREE.LineSegments(own(new THREE.EdgesGeometry(geo)), outline));
    bin.add(side);
  }

  // Brass rails along the top edges.
  const RAIL = 0.26;
  addBox(OUTER_W + 0.3, RAIL, WALL + 0.3, 0, H_FRONT + 0.05, Z_FRONT + WALL / 2, brass, false);
  addBox(OUTER_W + 0.3, RAIL, WALL + 0.3, 0, H_BACK + 0.05, Z_BACK - WALL / 2, brass, false);
  const slopeRise = H_BACK - H_FRONT;
  for (const sign of [1, -1]) {
    const rail = addBox(
      WALL + 0.3,
      RAIL,
      Math.hypot(DEPTH, slopeRise),
      sign * (W_IN / 2 + WALL / 2),
      (H_FRONT + H_BACK) / 2 + 0.05,
      Z_MID,
      brass,
      false
    );
    rail.rotation.x = Math.atan2(slopeRise, DEPTH);
  }

  // The ground: a pool of shadow and faint hatching that fades into the plate.
  const ground = new THREE.Mesh(
    own(new THREE.PlaneGeometry(160, 160)),
    own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uBase: { value: new THREE.Color(0x120c11) },
          uLine: { value: new THREE.Color(0x4b3b45) },
        },
        vertexShader: WORLD_VERTEX,
        fragmentShader: `
          uniform vec3 uBase;
          uniform vec3 uLine;
          varying vec3 vW;
          ${LINES_GLSL}
          void main() {
            vec2 c = vW.xz - vec2(0.0, ${Z_MID.toFixed(2)});
            float fade = 1.0 - smoothstep(9.0, 30.0, length(c));
            vec2 q = abs(c) - vec2(${(OUTER_W / 2).toFixed(2)}, ${(DEPTH / 2).toFixed(2)});
            float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
            float shadow = 1.0 - smoothstep(-0.5, 7.5, sd);
            float l1 = lines((vW.x * 0.8 + vW.z * 0.6) * 1.4, 0.07);
            float l2 = lines((vW.x * 0.6 - vW.z * 0.8) * 1.4, 0.05) * 0.6;
            vec3 col = mix(uBase, uLine, max(l1, l2) * 0.6 * (1.0 - shadow * 0.85));
            col *= 1.0 - shadow * 0.5;
            gl_FragColor = vec4(col, fade * mix(0.5, 0.97, shadow));
          }
        `,
      })
    )
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -2;
  scene.add(ground);

  // ── stars, fixed to the camera so they sit in the plate's sky ──

  const STAR_Z = 90;
  const starCount = 64;
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const halfH = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * STAR_Z;
  for (let k = 0; k < starCount; k++) {
    const up = Math.pow(hash(k, 1), 0.7);
    starPos[k * 3] = (hash(k, 2) - 0.5) * halfH * 2.6;
    starPos[k * 3 + 1] = halfH * (0.99 - up * 0.62);
    starPos[k * 3 + 2] = -STAR_Z;
    starSize[k] = hash(k, 3) > 0.84 ? 15 + hash(k, 4) * 9 : 4 + hash(k, 4) * 6;
    starPhase[k] = hash(k, 5) * 6.283;
  }
  const starGeo = own(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  const starMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: dpr },
        uColor: { value: new THREE.Color(0xf0dcae) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uDpr;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.62 + 0.38 * sin(uTime * (0.6 + fract(aPhase) * 0.9) + aPhase);
          gl_PointSize = aSize * uDpr * (0.85 + 0.3 * vTwinkle);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vTwinkle;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = length(p);
          float core = smoothstep(0.24, 0.0, d);
          float rays = (1.0 - smoothstep(0.0, 1.0, d)) * 0.014 / (abs(p.x * p.y) + 0.014);
          gl_FragColor = vec4(uColor, clamp(core + rays, 0.0, 1.0) * vTwinkle);
        }
      `,
    })
  );
  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.frustumCulled = false;
  starPoints.renderOrder = -3;
  camera.add(starPoints);

  // ── sleeves ──

  const sleeveGeo = own(new THREE.BoxGeometry(H, H, T));
  sleeveGeo.translate(0, H / 2, 0); // pivot on the bottom edge
  const discGeo = own(new THREE.CircleGeometry(5.85, 72));
  const tabGeo = own(new THREE.PlaneGeometry(1.9, 1.0));
  const stickerGeo = own(new THREE.PlaneGeometry(3.5, 2.2));

  const backTexture = own(
    canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#e4d9c2";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(23,29,48,0.07)";
      g.lineWidth = 1;
      for (let x = -h; x < w; x += 7) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + h, 0);
        g.stroke();
      }
      g.strokeStyle = "rgba(153,118,61,0.55)";
      g.lineWidth = 2;
      g.strokeRect(14, 14, w - 28, h - 28);
    })
  );

  // One material per distinct disc; plain black is shared by every sleeve.
  const discMaterials = new Map<string, THREE.ShaderMaterial>();
  function discMaterialFor(item: CrateItem) {
    const style = item.disc && item.disc.mode !== "picture" ? item.disc : BLACK_DISC;
    const key =
      style === BLACK_DISC
        ? "black"
        : `${item.id}|${style.mode}|${style.colors.map((c) => c.hex + c.alpha).join("|")}`;
    const cached = discMaterials.get(key);
    if (cached) return cached;
    const cols = [0, 1, 2].map((k) => {
      const c = style.colors[Math.min(k, style.colors.length - 1)];
      const rgb = new THREE.Color(c.hex);
      return new THREE.Vector4(rgb.r, rgb.g, rgb.b, c.alpha);
    });
    const material = own(
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: style.colors.some((c) => c.alpha < 1),
        uniforms: {
          uCol: { value: cols },
          uCount: { value: style.colors.length },
          uMode: { value: DISC_MODES[style.mode] ?? 0 },
          uParts: { value: style.parts ?? 8 },
          uSeed: { value: hash(item.id, 7) * 40 },
        },
        vertexShader: `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: DISC_FRAGMENT,
      })
    );
    discMaterials.set(key, material);
    return material;
  }

  function placeholderTexture(item: CrateItem) {
    const [bg, fg] = TINTS[Math.floor(hash(item.id, 9) * TINTS.length)];
    return canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `400 104px ${fonts.heading}`;
      g.fillText(item.initials, w / 2, h / 2 + 6);
    });
  }

  const tabTextures = new Map<string, THREE.Texture>();
  function tabTexture(letter: string) {
    let tex = tabTextures.get(letter);
    if (!tex) {
      tex = own(
        canvasTexture(152, 80, (g, w, h) => {
          g.fillStyle = "#efe1c3";
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(37,27,51,0.45)";
          g.lineWidth = 4;
          g.strokeRect(2, 2, w - 4, h + 8);
          g.fillStyle = "#582236";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.font = `400 58px ${fonts.caps}`;
          g.fillText(letter, w / 2, h / 2 + 3);
        })
      );
      tabTextures.set(letter, tex);
    }
    return tex;
  }

  function stickerTexture(lines: string[]) {
    return canvasTexture(350, 220, (g, w, h) => {
      g.fillStyle = "#e0c796";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#99763d";
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = "#372a16";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      if (lines.length < 2) {
        g.font = `400 96px ${fonts.caps}`;
        g.fillText(lines[0] ?? "", w / 2, 142);
        return;
      }
      g.font = `400 112px ${fonts.heading}`;
      g.fillText(lines[0], w / 2, 122);
      g.font = `400 50px ${fonts.caps}`;
      spaced(g, 3);
      g.fillText(lines[1], w / 2, 186);
    });
  }

  // Cover textures outlive their sleeve for a while, so filtering or
  // flipping back doesn't reload them.
  const textureLoader = new THREE.TextureLoader();
  const covers = new Map<string, { tex: THREE.Texture | null; refs: number; waiting: ((t: THREE.Texture) => void)[] }>();
  function takeCover(url: string, onLoad: (t: THREE.Texture) => void) {
    let entry = covers.get(url);
    if (entry) {
      covers.delete(url); // re-insert: most recently used last
      covers.set(url, entry);
      entry.refs++;
      if (entry.tex) onLoad(entry.tex);
      else entry.waiting.push(onLoad);
      return;
    }
    entry = { tex: null, refs: 1, waiting: [onLoad] };
    covers.set(url, entry);
    const mine = entry;
    textureLoader.load(
      url,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.anisotropy = maxAniso;
        mine.tex = tex;
        for (const cb of mine.waiting.splice(0)) cb(tex);
      },
      undefined,
      () => {
        covers.delete(url); // the sleeve keeps its initials
      }
    );
  }
  function releaseCover(url: string) {
    const entry = covers.get(url);
    if (entry) entry.refs--;
    if (covers.size <= COVER_CACHE_MAX) return;
    for (const [key, e] of covers) {
      if (covers.size <= COVER_CACHE_MAX) break;
      if (e.refs <= 0 && e.tex) {
        e.tex.dispose();
        covers.delete(key);
      }
    }
  }

  let items: CrateItem[] = [];
  let signature = "";
  let positions = new Map<number, number>(); // record id -> position in items
  let index = 0;
  let hovered = -1;
  let disposed = false;
  const sleeves = new Map<number, Sleeve>(); // by record id
  const leaving: Sleeve[] = [];
  const stack = new THREE.Group();
  scene.add(stack);

  function poseFor(i: number): Pose {
    const d = i - index;
    if (d === 0) return { x: HELD.x, y: HELD.y, z: HELD.z, rx: HELD.rx, ry: HELD.ry, rz: 0, dim: 1 };
    const id = items[i].id;
    const x = (hash(id, 1) - 0.5) * 0.3;
    const rz = (hash(id, 2) - 0.5) * 0.022;
    if (d > 0) {
      const standing = Math.min(items.length - 1 - index, BEHIND);
      return {
        x,
        y: FLOOR + (hovered === i ? 0.9 : 0),
        z: Z_B_REST + (standing - d) * GAP,
        rx: -LEAN_B,
        ry: 0,
        rz,
        dim: Math.max(0.3, 0.9 - (d - 1) * 0.042),
      };
    }
    const k = -d;
    const flipped = Math.min(index, FLIPPED);
    return {
      x,
      y: FLOOR,
      z: Z_F_REST - (flipped - k) * GAP,
      rx: LEAN_F,
      ry: 0,
      rz,
      dim: Math.max(0.36, 0.62 - (k - 1) * 0.05),
    };
  }

  class Sleeve {
    item: CrateItem;
    mesh: THREE.Mesh;
    p: SleeveState;
    leaving = false;
    exit: Pose | null = null;
    private front: THREE.MeshBasicMaterial;
    private back: THREE.MeshBasicMaterial;
    private edge: THREE.MeshBasicMaterial;
    private tabMat: THREE.MeshBasicMaterial | null = null;
    private stickerMat: THREE.MeshBasicMaterial | null = null;
    private mats: THREE.MeshBasicMaterial[];
    private disc: THREE.Mesh;
    private showDisc: boolean;
    private placeholder: THREE.Texture;
    private clear = false;
    private gone = false;

    constructor(item: CrateItem, pose: Pose) {
      this.item = item;
      this.placeholder = placeholderTexture(item);
      this.front = new THREE.MeshBasicMaterial({ map: this.placeholder });
      this.back = new THREE.MeshBasicMaterial({ map: backTexture });
      this.edge = new THREE.MeshBasicMaterial({ color: PAPER });
      this.mats = [this.front, this.back, this.edge];
      this.mesh = new THREE.Mesh(sleeveGeo, [
        this.edge,
        this.edge,
        this.edge,
        this.edge,
        this.front,
        this.back,
      ]);
      this.mesh.rotation.order = "YXZ";
      this.mesh.userData.sleeve = this;

      this.disc = new THREE.Mesh(discGeo, discMaterialFor(item));
      this.disc.position.set(0, H / 2, 0);
      this.disc.visible = false;
      this.mesh.add(this.disc);
      // A picture disc can't be drawn from a description: it stays in the sleeve.
      this.showDisc = item.disc?.mode !== "picture";

      if (item.tab) {
        this.tabMat = new THREE.MeshBasicMaterial({
          map: tabTexture(item.tab),
          side: THREE.DoubleSide,
        });
        this.mats.push(this.tabMat);
        const tab = new THREE.Mesh(tabGeo, this.tabMat);
        tab.position.set(-H / 2 + 1.3 + ((item.tab.charCodeAt(0) * 7) % 5) * 2.3, H + 0.44, 0);
        this.mesh.add(tab);
      }

      if (item.cover) {
        takeCover(item.cover, (tex) => {
          if (this.gone) return;
          this.front.map = tex;
          this.front.needsUpdate = true;
        });
      }

      this.p = { ...pose, op: 0, slide: 0, tag: 0 };
    }

    private sticker() {
      if (this.stickerMat) return;
      this.stickerMat = new THREE.MeshBasicMaterial({
        map: stickerTexture(this.item.sticker),
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(stickerGeo, this.stickerMat);
      mesh.position.set(H / 2 - 1.9, H - 1.7, T / 2 + 0.03);
      mesh.rotation.z = -0.07;
      this.mesh.add(mesh);
    }

    update(dt: number, now: number) {
      const at = this.leaving ? -1 : (positions.get(this.item.id) ?? -1);
      const held = at === index && !this.leaving;
      const tgt = this.leaving || at === -1 ? (this.exit ?? this.p) : poseFor(at);
      const p = this.p;
      const a = ease(dt, held ? 6.5 : 9);
      const b = ease(dt, held ? 9 : 7.5);
      p.x += (tgt.x - p.x) * a;
      p.z += (tgt.z - p.z) * a;
      p.rx += (tgt.rx - p.rx) * a;
      p.ry += (tgt.ry - p.ry) * a;
      p.rz += (tgt.rz - p.rz) * a;
      p.y += (tgt.y - p.y) * b;
      p.dim += (tgt.dim - p.dim) * ease(dt, 8);
      p.op += ((this.leaving ? 0 : 1) - p.op) * ease(dt, 10);

      const settled = held && Math.abs(tgt.y - p.y) < 0.5;
      p.slide += ((settled && this.showDisc ? 1 : 0) - p.slide) * ease(dt, settled ? 3.5 : 14);
      p.tag += ((settled ? 1 : 0) - p.tag) * ease(dt, settled ? 7 : 16);
      if (held) this.sticker();

      let y = p.y;
      let rz = p.rz;
      if (held && !reduceMotion) {
        y += Math.sin(now * 1.2) * 0.09 * p.tag;
        rz += Math.sin(now * 0.8) * 0.006 * p.tag;
      }
      this.mesh.position.set(p.x, y, p.z);
      this.mesh.rotation.set(p.rx, p.ry, rz);

      // A sold record's cover is shown, but faded.
      const dim = p.dim * (this.item.sold ? 0.6 : 1);
      this.front.color.setScalar(dim);
      this.back.color.setScalar(p.dim);
      this.edge.color.copy(PAPER).multiplyScalar(p.dim);
      if (this.tabMat) this.tabMat.color.setScalar(Math.min(1, p.dim + 0.08));

      const clear = p.op < 0.995;
      if (clear !== this.clear) {
        this.clear = clear;
        for (const m of this.mats) {
          m.transparent = clear;
          m.needsUpdate = true;
        }
      }
      for (const m of this.mats) m.opacity = clear ? p.op : 1;

      this.disc.visible = p.slide > 0.01;
      this.disc.position.x = p.slide * 4.2;
      if (this.stickerMat) this.stickerMat.opacity = p.tag * p.op;
    }

    dispose() {
      this.gone = true;
      stack.remove(this.mesh);
      if (this.item.cover) releaseCover(this.item.cover);
      this.placeholder.dispose();
      this.stickerMat?.map?.dispose();
      this.stickerMat?.dispose();
      for (const m of this.mats) m.dispose();
    }
  }

  // Keep sleeves mounted only for the stretch of the crate you can see.
  function sync(jump: boolean, tumble: boolean) {
    const last = items.length - 1;
    const from = Math.max(0, index - FLIPPED);
    const to = Math.min(last, index + BEHIND);
    const keep = new Set<number>();
    for (let i = from; i <= to; i++) keep.add(items[i].id);

    for (const [id, s] of sleeves) {
      if (keep.has(id)) continue;
      sleeves.delete(id);
      if (jump) {
        s.dispose();
      } else {
        s.leaving = true;
        s.exit = { ...s.p, rx: s.p.rx + (s.p.rx > 0 ? 0.12 : 0), dim: 0.2 };
        leaving.push(s);
      }
    }
    for (let i = from; i <= to; i++) {
      const item = items[i];
      if (sleeves.has(item.id)) continue;
      const s = new Sleeve(item, poseFor(i));
      if (jump && i === index && !reduceMotion) {
        if (tumble) {
          s.p.y += 22;
          s.p.rx = -1.1;
          s.p.rz = -0.45;
          s.p.op = 1;
        } else {
          s.p.y += 5; // settles in from just above
        }
      } else if (jump) {
        s.p.op = 1;
      }
      sleeves.set(item.id, s);
      stack.add(s.mesh);
    }
  }

  // ── pointer: hover lifts a record further back; the view leans a little ──

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function pick(clientX: number, clientY: number) {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return -1;
    pointer.set(
      ((clientX - box.left) / box.width) * 2 - 1,
      -((clientY - box.top) / box.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const meshes: THREE.Object3D[] = [];
    for (const s of sleeves.values()) meshes.push(s.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return -1;
    const sleeve = hit.object.userData.sleeve as Sleeve;
    return positions.get(sleeve.item.id) ?? -1;
  }

  function onMove(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    const i = pick(e.clientX, e.clientY);
    hovered = i > index ? i : -1;
    stage.style.cursor = i === -1 ? "grab" : "pointer";
    if (reduceMotion) return;
    look.dAz = pointer.x * 0.07;
    look.dEl = pointer.y * 0.035;
    stage.style.setProperty("--crate-px", `${(-pointer.x * 7).toFixed(1)}px`);
    stage.style.setProperty("--crate-py", `${(pointer.y * 4).toFixed(1)}px`);
  }
  function onLeave() {
    hovered = -1;
    look.dAz = 0;
    look.dEl = 0;
    stage.style.setProperty("--crate-px", "0px");
    stage.style.setProperty("--crate-py", "0px");
  }
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerleave", onLeave);

  // ── run ──

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let onScreen = true;
  const viewObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
  });
  viewObserver.observe(stage);

  let before = performance.now();
  let painted = false;
  let raf = 0;
  function frame(nowMs: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (nowMs - before) / 1000);
    before = nowMs;
    if (!onScreen || !items.length) return;
    const now = nowMs / 1000;

    look.az += (CAM.az + look.dAz - look.az) * ease(dt, 4);
    look.el += (CAM.el + look.dEl - look.el) * ease(dt, 4);
    // A narrow stage pulls the camera back so the whole bin stays in frame.
    const dist = CAM.dist * Math.max(1, 0.94 / camera.aspect);
    camera.position.set(
      CAM.target.x + dist * Math.cos(look.el) * Math.sin(look.az),
      CAM.target.y + dist * Math.sin(look.el),
      CAM.target.z + dist * Math.cos(look.el) * Math.cos(look.az)
    );
    camera.lookAt(CAM.target);

    for (const s of sleeves.values()) s.update(dt, now);
    for (let k = leaving.length - 1; k >= 0; k--) {
      const s = leaving[k];
      s.update(dt, now);
      if (s.p.op < 0.02) {
        s.dispose();
        leaving.splice(k, 1);
      }
    }
    if (!reduceMotion) starMat.uniforms.uTime.value = now;
    renderer.render(scene, camera);
    if (!painted) {
      painted = true;
      onReady?.();
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    update(nextItems, nextIndex, fall = false) {
      if (disposed) return;
      const first = items.length === 0;
      // Compare by content: the list is rebuilt on every render upstream.
      const nextSignature = nextItems.map((it) => `${it.id}${it.tab ?? ""}`).join(",");
      const listChanged = nextSignature !== signature;
      const clamped = Math.min(Math.max(0, nextItems.length - 1), Math.max(0, nextIndex));
      const far = Math.abs(clamped - index) > 3;
      items = nextItems;
      index = clamped;
      hovered = -1;
      if (listChanged) {
        signature = nextSignature;
        positions = new Map(items.map((it, i) => [it.id, i]));
        // A new filter or sort: restock the bin rather than animate the shuffle.
        for (const s of sleeves.values()) s.dispose();
        sleeves.clear();
      }
      if (!items.length) return;
      sync(fall || listChanged || far, fall || first);
    },
    pick,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.style.cursor = "";
      for (const s of sleeves.values()) s.dispose();
      for (const s of leaving) s.dispose();
      sleeves.clear();
      leaving.length = 0;
      for (const e of covers.values()) e.tex?.dispose();
      covers.clear();
      for (const d of owned) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
