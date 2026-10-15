// Calcomanías: la imagen se proyecta gnomónicamente desde el centro de la esfera.

const D2R = Math.PI / 180;

// Centros repartidos parejo según la cantidad (el primero mira al frente).
const BASE = {
  1: [[0, 0, 1]],
  2: [[0, 0, 1], [0, 0, -1]],
  3: [0, 120, 240].map(a => [Math.sin(a * D2R), 0, Math.cos(a * D2R)]),
  // tetraedro: un vértice al frente y tres a z = -1/3 sobre un anillo de radio √8/3
  4: [[0, 0, 1], ...[0, 120, 240].map(a => [Math.sin(a * D2R) * 0.9428, Math.cos(a * D2R) * 0.9428, -1 / 3])],
  5: [[0, 0, 1], [Math.sin(2.0944), 0, Math.cos(2.0944)], [Math.sin(4.1888), 0, Math.cos(4.1888)], [0, 1, 0], [0, -1, 0]], // bipirámide
  6: [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], // octaedro
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

/**
 * Marcos locales (c = centro, e1 = derecha, e2 = arriba; e1×e2 = c) de las N calcos,
 * con toda la disposición rotada a (lon, lat) en grados.
 */
export function frames(count, lon, lat) {
  const cl = Math.cos(lat * D2R), sl = Math.sin(lat * D2R), cL = Math.cos(lon * D2R), sL = Math.sin(lon * D2R);
  const rot = ([x, y, z]) => { // Rx(-lat) y después Ry(lon)
    const y1 = y * cl + z * sl, z1 = -y * sl + z * cl;
    return [x * cL + z1 * sL, y1, -x * sL + z1 * cL];
  };
  return BASE[count].map(c => {
    const e1 = Math.abs(c[1]) > 0.9 ? [1, 0, 0] : norm(cross([0, 1, 0], c));
    return { c: rot(c), e1: rot(e1), e2: rot(cross(c, e1)) };
  });
}

/** Baja la imagen a <=512px y devuelve sus píxeles RGBA. */
export function prepareImage(img) {
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  return { w, h, data: g.getImageData(0, 0, w, h).data };
}

// Muestreo bilineal con alfa premultiplicado (evita halos negros en bordes transparentes).
function sample(im, x, y, o) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let R = 0, G = 0, B = 0, A = 0;
  for (let q = 0; q < 4; q++) {
    const xi = Math.min(im.w - 1, Math.max(0, x0 + (q & 1))), yi = Math.min(im.h - 1, Math.max(0, y0 + (q >> 1)));
    const w = ((q & 1) ? fx : 1 - fx) * ((q >> 1) ? fy : 1 - fy), i = (yi * im.w + xi) * 4, a = im.data[i + 3] / 255 * w;
    R += im.data[i] * a; G += im.data[i + 1] * a; B += im.data[i + 2] * a; A += a;
  }
  o[0] = A > 0 ? R / A : 0; o[1] = A > 0 ? G / A : 0; o[2] = A > 0 ? B / A : 0; o[3] = A;
}

/**
 * Proyección gnomónica: para la dirección d del texel y el centro c de la calco,
 *   u = (d·e1)/(d·c),  v = (d·e2)/(d·c)
 * son las coordenadas donde el rayo desde el centro de la esfera corta el plano tangente en c.
 * Como es una proyección central, la imagen sale sin estirarse (cerca de un polo también).
 * El tamaño angular s (grados) fija el semiancho del plano: tan(s/2).
 */
export function paintDecals(out, W, H, { frames: fr, im, size, rot }) {
  const half = Math.tan(size * D2R / 2), M = Math.max(im.w, im.h);
  const hx = half * im.w / M, hy = half * im.h / M;
  const minDot = 1 / Math.sqrt(1 + 2 * half * half); // fuera de este cono no puede caer la imagen
  const cr = Math.cos(rot * D2R), sr = Math.sin(rot * D2R), px = M / (2 * half), px0 = im.w / 2, py0 = im.h / 2;
  const cosP = new Float32Array(W), sinP = new Float32Array(W), s = [0, 0, 0, 0];
  for (let i = 0; i < W; i++) { const p = 2 * Math.PI * (i + 0.5) / W; cosP[i] = Math.cos(p); sinP[i] = Math.sin(p); }
  for (let j = 0; j < H; j++) {
    const th = Math.PI * (j + 0.5) / H, sinT = Math.sin(th), y = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const x = -cosP[i] * sinT, z = sinP[i] * sinT;
      for (const f of fr) {
        const dc = x * f.c[0] + y * f.c[1] + z * f.c[2];
        if (dc < minDot) continue;
        let u = (x * f.e1[0] + y * f.e1[1] + z * f.e1[2]) / dc, v = (x * f.e2[0] + y * f.e2[1] + z * f.e2[2]) / dc;
        const u2 = u * cr + v * sr; v = -u * sr + v * cr; u = u2;
        if (u < -hx || u > hx || v < -hy || v > hy) continue;
        sample(im, px0 + u * px, py0 - v * px, s);
        if (s[3] <= 0) continue;
        const o = j * W + i, d = out[o], a = s[3];
        out[o] = (255 << 24)
          | (((s[2] * a + ((d >> 16) & 255) * (1 - a)) | 0) << 16)
          | (((s[1] * a + ((d >> 8) & 255) * (1 - a)) | 0) << 8)
          | ((s[0] * a + (d & 255) * (1 - a)) | 0);
      }
    }
  }
}
