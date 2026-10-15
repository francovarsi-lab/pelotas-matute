// Vista plana ("desplegable"). Cada pixel del recuadro se calcula por proyección inversa:
//   pixel -> (lon, lat) -> dirección 3D -> texel de la textura equirectangular.
// Convención: dir = (cosφ·sinλ, sinφ, cosφ·cosλ); λ = 0 mira al frente (+z).
// Textura: u = (λ + π/2)/2π, v = (π/2 − φ)/π (igual que SphereGeometry).

export const PW = 640, PH = 320;
const TAU = 2 * Math.PI, HP = Math.PI / 2, STEP = Math.PI / 6; // grilla cada 30°
const c32 = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
const HATCH_A = c32(58, 61, 68), HATCH_B = c32(70, 74, 82);
const GRID = c32(47, 107, 255), MERID = c32(225, 29, 72), CUT = c32(255, 159, 28);

export function createPlane() {
  const n = PW * PH;
  const su = new Float32Array(n), sv = new Float32Array(n);
  const valid = new Uint8Array(n), line = new Uint8Array(n); // line: 1 grilla, 2 meridiano central, 3 corte
  let kind = 'sin', N = 1, k = PW / TAU;

  /**
   * Sinusoidal: x = λ·cosφ, y = φ (k px por radián). Con N gajos es la sinusoidal interrumpida:
   * cada gajo tiene su propio meridiano central y entre gajos queda un hueco.
   * Devuelve [lon, lat] o null si el pixel cae fuera de la pelota.
   */
  function inv(px, py) {
    if (kind === 'rect') {
      if (px < 0 || px >= PW || py < 0 || py >= PH) return null;
      return [((px / PW * TAU - HP + 3 * Math.PI) % TAU) - Math.PI, (0.5 - py / PH) * Math.PI];
    }
    const la = (PH / 2 - py) / k;
    if (Math.abs(la) > HP) return null;
    const i = Math.floor(px / (PW / N));
    if (i < 0 || i >= N) return null;
    const c = Math.cos(la);
    if (c < 1e-6) return null;
    const rel = (px - (i + 0.5) * PW / N) / (k * c);
    if (Math.abs(rel) > Math.PI / N) return null;
    return [-Math.PI + (i + 0.5) * TAU / N + rel, la];
  }

  /** (lon, lat) -> [px, py] en el plano (inversa de inv; siempre devuelve un punto). */
  function fwd(lon, la) {
    if (kind === 'rect') return [(((lon + HP) % TAU + TAU) % TAU) / TAU * PW, (0.5 - la / Math.PI) * PH];
    const i = Math.min(N - 1, Math.max(0, Math.floor((lon + Math.PI) / (TAU / N))));
    return [(i + 0.5) * PW / N + (lon - (-Math.PI + (i + 0.5) * TAU / N)) * Math.cos(la) * k, PH / 2 - la * k];
  }

  function setMode(kind_, N_ = 1) {
    kind = kind_; N = kind === 'sin' ? N_ : 1;
    k = (PW / TAU) * (N > 1 ? 0.88 : 1); // con huecos entre gajos se achica un poco
    const LON = new Float32Array(n), LAT = new Float32Array(n);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const i = y * PW + x, r = inv(x + 0.5, y + 0.5);
      if (!r) { valid[i] = 0; continue; }
      valid[i] = 1; LON[i] = r[0]; LAT[i] = r[1];
      su[i] = (((r[0] + HP) / TAU) % 1 + 1) % 1; sv[i] = (HP - r[1]) / Math.PI;
    }
    const rect = kind === 'rect';
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const i = y * PW + x; line[i] = 0;
      if (!valid[i]) continue;
      // borde de corte: vecino fuera de la forma (en la sinusoidal, el borde del canvas también cuenta)
      const out = (xx, yy) => (xx < 0 || yy < 0 || xx >= PW || yy >= PH) ? !rect : !valid[yy * PW + xx];
      if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) { line[i] = 3; continue; }
      const la = LAT[i], lo = LON[i], cl = rect ? 1 : Math.cos(la);
      const pxLon = rect ? PW / TAU : k * cl;
      const rel = rect ? lo : lo - (-Math.PI + (Math.floor(x / (PW / N)) + 0.5) * TAU / N); // dentro del gajo
      if (Math.abs(rel) * pxLon < 0.8) { line[i] = 2; continue; }
      const mLa = la / STEP, mLo = lo / STEP;
      if (Math.abs(mLa - Math.round(mLa)) * STEP * (rect ? PH / Math.PI : k) < 0.75 ||
          Math.abs(mLo - Math.round(mLo)) * STEP * pxLon < 0.75) line[i] = 1;
    }
  }

  /** Pinta el plano muestreando la textura equirectangular (buf, w x h) en out (Uint32 PW x PH). */
  function render(buf, w, h, out, grid) {
    for (let i = 0; i < n; i++) {
      if (!valid[i]) { out[i] = (((i % PW + ((i / PW) | 0)) >> 2) & 1) ? HATCH_A : HATCH_B; continue; }
      const l = line[i];
      if (l === 3) out[i] = CUT;
      else if (l === 2) out[i] = MERID;
      else if (l === 1 && grid) out[i] = GRID;
      else out[i] = buf[Math.min(h - 1, (sv[i] * h) | 0) * w + Math.min(w - 1, (su[i] * w) | 0)];
    }
  }

  /** Polos en el plano: [x, y, 'N'|'S']. */
  function poles() {
    if (kind === 'rect') return [[PW / 2, 2, 'N'], [PW / 2, PH - 2, 'S']];
    const out = [];
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * PW / N;
      out.push([x, PH / 2 - HP * k, 'N'], [x, PH / 2 + HP * k, 'S']);
    }
    return out;
  }

  setMode('sin', 1);
  return { setMode, inv, fwd, render, poles, get gap() { return kind === 'rect' ? PW / 4 : N > 1 ? PW / N * 0.6 : PW / 4; } };
}
