// Plantillas de paneles. Todo se calcula por dirección 3D de cada texel
// de la textura equirectangular (W x H), así no hay deformación en los polos.

export const W = 2048, H = 1024;

const PHI = (1 + Math.sqrt(5)) / 2, IP = 1 / PHI;
const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const S = [1, -1];

const cubeFaces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const cubeVerts = S.flatMap(a => S.flatMap(b => S.map(c => [a, b, c])));
// 12 vértices del icosaedro (centros de los pentágonos)
const icosa = S.flatMap(a => S.flatMap(b => [[0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]]));
// 20 vértices del dodecaedro (centros de los hexágonos)
const dodeca = [...cubeVerts,
  ...S.flatMap(a => S.flatMap(b => [[0, a * PHI, b * IP], [a * IP, 0, b * PHI], [a * PHI, b * IP, 0]]))];

// pts: centros de panel (Voronoi esférico). count: paneles sin puntos (lisa, gajos).
export const TEMPLATES = {
  p14: { name: '14 paneles', pts: [...cubeFaces, ...cubeVerts].map(unit), color: i => (i < 6 ? '#f5f2ea' : '#2563eb') },
  p32: { name: '32 paneles clásica', pts: [...icosa, ...dodeca].map(unit), color: i => (i < 12 ? '#1c1c1c' : '#f5f2ea') },
  lisa: { name: 'Lisa', count: () => 1, color: () => '#f5f2ea' },
  gajos: { name: 'Rayas / gajos', count: n => n, color: i => (i % 2 ? '#f5f2ea' : '#d62828') },
};

export const panelCount = (t, n) => TEMPLATES[t].pts?.length ?? TEMPLATES[t].count(n);
export const defaultColors = (t, n) => Array.from({ length: panelCount(t, n) }, (_, i) => TEMPLATES[t].color(i));

// Dirección (x,y,z) -> índice de panel. Misma convención que SphereGeometry de three:
// x = -cosφ·sinθ, y = cosθ, z = sinφ·sinθ, con u = φ/2π.
export function panelAt(t, n, x, y, z) {
  const T = TEMPLATES[t];
  if (T.pts) {
    let b = -2, bi = 0;
    T.pts.forEach((p, k) => { const d = x * p[0] + y * p[1] + z * p[2]; if (d > b) { b = d; bi = k; } });
    return bi;
  }
  if (t === 'lisa') return 0;
  let phi = Math.atan2(z, -x); if (phi < 0) phi += 2 * Math.PI;
  return Math.min(n - 1, Math.floor(phi / (2 * Math.PI) * n));
}

/**
 * Para cada texel calcula el panel (ids) y la distancia angular aprox. al borde (mar, radianes).
 *
 * Voronoi esférico: el panel de una dirección d es el centro c_k con mayor d·c_k (el más cercano
 * en la esfera). El borde entre los centros c1 (mejor) y c2 (segundo) es el plano bisector, y la
 * distancia angular de d a ese plano es asin(d·(c1−c2)/|c1−c2|) ≈ (d·c1 − d·c2)/|c1−c2|.
 * Eso da costuras de grosor angular uniforme, también cerca de los polos.
 */
export function buildMap(t, n) {
  const T = TEMPLATES[t];
  const ids = new Uint8Array(W * H), mar = new Float32Array(W * H);
  const cosP = new Float32Array(W), sinP = new Float32Array(W);
  for (let i = 0; i < W; i++) { const p = 2 * Math.PI * (i + 0.5) / W; cosP[i] = Math.cos(p); sinP[i] = Math.sin(p); }

  if (!T.pts) {
    for (let j = 0; j < H; j++) {
      const sinT = Math.sin(Math.PI * (j + 0.5) / H);
      for (let i = 0; i < W; i++) {
        const o = j * W + i;
        if (t === 'lisa') { mar[o] = 9; continue; }
        const a = (i + 0.5) / W * n, f = a - Math.floor(a);
        ids[o] = Math.min(n - 1, Math.floor(a));
        // distancia al meridiano más cercano, en radianes sobre la esfera
        mar[o] = Math.min(f, 1 - f) * 2 * Math.PI / n * sinT;
      }
    }
    return { ids, mar };
  }

  const k = T.pts.length, P = new Float32Array(T.pts.flat()), D = new Float32Array(k * k);
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
    D[a * k + b] = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
  }
  for (let j = 0; j < H; j++) {
    const th = Math.PI * (j + 0.5) / H, sinT = Math.sin(th), y = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const x = -cosP[i] * sinT, z = sinP[i] * sinT;
      let b = -2, bi = 0, s = -2, si = 0;
      for (let q = 0; q < k; q++) {
        const d = x * P[3 * q] + y * P[3 * q + 1] + z * P[3 * q + 2];
        if (d > b) { s = b; si = bi; b = d; bi = q; } else if (d > s) { s = d; si = q; }
      }
      const o = j * W + i;
      ids[o] = bi;
      mar[o] = (b - s) / D[bi * k + si];
    }
  }
  return { ids, mar };
}

const rgb = h => { const v = parseInt(h.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

/** Pinta colores de panel + costuras (halfw = medio grosor en radianes) en un Uint32Array RGBA. */
export function paintBase({ ids, mar }, colors, seamHex, halfw, out) {
  const cols = colors.map(rgb), c32 = cols.map(c => (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]);
  const sc = rgb(seamHex), s32 = (255 << 24) | (sc[2] << 16) | (sc[1] << 8) | sc[0];
  const aa = 3 * Math.PI / Math.sqrt(out.length * 2); // ~1.5 texels de suavizado (según resolución)
  for (let o = 0; o < out.length; o++) {
    const id = ids[o];
    const a = halfw > 0 ? Math.min(1, Math.max(0, (halfw - mar[o]) / aa + 0.5)) : 0;
    if (a <= 0) out[o] = c32[id];
    else if (a >= 1) out[o] = s32;
    else {
      const c = cols[id];
      out[o] = (255 << 24) | (((c[2] + (sc[2] - c[2]) * a) | 0) << 16) | (((c[1] + (sc[1] - c[1]) * a) | 0) << 8) | ((c[0] + (sc[0] - c[0]) * a) | 0);
    }
  }
}

/** Mapa a mitad de resolución (W/2 x H/2) submuestreando el completo: para repintar rápido mientras se arrastra. */
export function halve({ ids, mar }) {
  const w = W / 2, h = H / 2, i2 = new Uint8Array(w * h), m2 = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const s = 2 * j * W + 2 * i; i2[j * w + i] = ids[s]; m2[j * w + i] = mar[s]; }
  return { ids: i2, mar: m2 };
}
