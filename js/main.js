// Escena 3D + pegamento entre plantillas, calcos, vista plana y UI.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { TEMPLATES, W, H, buildMap, halve, paintBase, panelAt, defaultColors } from './templates.js';
import { frames, prepareImage, paintDecals } from './decals.js';
import { createPlane, PW, PH } from './planeview.js';
import { $, initSheet, bindRange, renderTemplates, renderChips, initPalette } from './ui.js';

const D2R = Math.PI / 180;
const state = {
  tpl: 'p32', n: 8, sel: 0, seam: '#1a1a1a', thick: 1.2,
  im: null, count: 1, size: 50, rot: 0, lon: 0, lat: 0,
  grid: false, hl: -1, hover: null,
};
const colorsByKey = {};
const key = () => state.tpl + (state.tpl === 'gajos' ? state.n : '');
const colors = () => (colorsByKey[key()] ??= defaultColors(state.tpl, state.n));

// ---- Textura interna (equirectangular 2:1, la que usa la esfera) ----
const flat = document.createElement('canvas'); flat.width = W; flat.height = H;
const fctx = flat.getContext('2d'), imgData = fctx.createImageData(W, H), px = new Uint32Array(imgData.data.buffer);
const lowC = document.createElement('canvas'); lowC.width = W / 2; lowC.height = H / 2;
const lctx = lowC.getContext('2d'), lowData = lctx.createImageData(W / 2, H / 2), lowPx = new Uint32Array(lowData.data.buffer);
let map = null, lowMap = null, queued = false, lowQ = false, timer = 0, needRender = true, flash = -1, flashTimer = 0;
let cur = { buf: px, w: W, h: H }; // último buffer pintado: de ahí muestrea la vista plana

// ---- Vista plana (desplegable): otra proyección, calculada por pixel ----
const plane = createPlane();
const pcv = document.createElement('canvas'); pcv.width = PW; pcv.height = PH;
$('flatbox').append(pcv);
const pctx = pcv.getContext('2d'), pImg = pctx.createImageData(PW, PH), p32 = new Uint32Array(pImg.data.buffer);
let handles = {};

const lonOf = p => Math.atan2(p.x, p.z) / D2R, latOf = p => Math.asin(Math.max(-1, Math.min(1, p.y))) / D2R;
const toDir = (lo, la) => new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));

function overlay() {
  const c = pctx; handles = {};
  c.save(); c.lineJoin = 'round';
  const stroke = (w1, w2) => { c.strokeStyle = '#000'; c.lineWidth = w1; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = w2; c.stroke(); };
  // polos
  c.font = 'bold 11px system-ui'; c.textAlign = 'center';
  for (const [x, y, t] of plane.poles()) {
    c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#fff'; c.fillText(t, x, t === 'N' ? y + 15 : y - 8);
  }
  // calcos: contorno proyectado tal cual cae en el plano (con su deformación)
  if (state.im) {
    const half = Math.tan(state.size * D2R / 2), M = Math.max(state.im.w, state.im.h);
    const hx = half * state.im.w / M, hy = half * state.im.h / M, cr = Math.cos(state.rot * D2R), sr = Math.sin(state.rot * D2R);
    frames(state.count, state.lon, state.lat).forEach((f, fi) => {
      // (a,b) = coordenadas en el plano de la imagen -> dirección -> plano
      const P = (a, b) => {
        const u = a * cr - b * sr, v = a * sr + b * cr;
        const x = f.c[0] + u * f.e1[0] + v * f.e2[0], y = f.c[1] + u * f.e1[1] + v * f.e2[1], z = f.c[2] + u * f.e1[2] + v * f.e2[2];
        return plane.fwd(Math.atan2(x, z), Math.asin(y / Math.hypot(x, y, z)));
      };
      let prev = null;
      c.beginPath();
      const edge = (a0, b0, a1, b1) => {
        for (let s = 0; s <= 16; s++) {
          const q = P(a0 + (a1 - a0) * s / 16, b0 + (b1 - b0) * s / 16);
          if (prev && Math.abs(q[0] - prev[0]) < plane.gap && Math.abs(q[1] - prev[1]) < PH / 2) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]);
          prev = q;
        }
      };
      edge(-hx, -hy, hx, -hy); edge(hx, -hy, hx, hy); edge(hx, hy, -hx, hy); edge(-hx, hy, -hx, -hy);
      stroke(3.5, 1.5);
      if (fi === 0) { // asas del primer calco: cuadrado = tamaño, círculo = rotación
        const top = P(0, hy), s = P(hx, hy), r = P(0, hy + 0.35 * half);
        handles = { scale: s, rot: r };
        c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(r[0], r[1]); stroke(3.5, 1.5);
        c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.fillRect(s[0] - 5, s[1] - 5, 10, 10); c.strokeRect(s[0] - 5, s[1] - 5, 10, 10);
        c.beginPath(); c.arc(r[0], r[1], 5.5, 0, 7); c.fill(); c.stroke();
      }
    });
  }
  // cursor sincronizado
  if (state.hover) {
    const q = plane.fwd(lonOf(state.hover) * D2R, latOf(state.hover) * D2R);
    c.beginPath(); c.arc(q[0], q[1], 6, 0, 7); c.strokeStyle = '#000'; c.lineWidth = 3.5; c.stroke();
    c.strokeStyle = '#ff3b30'; c.lineWidth = 2; c.stroke();
  }
  c.restore();
}

function drawPlane(sample) {
  if (sample) plane.render(cur.buf, cur.w, cur.h, p32, state.grid);
  pctx.putImageData(pImg, 0, 0);
  overlay();
}

// Cuadrícula de 30° sobre la textura equirectangular; el meridiano central (λ=0, u=.25) va en rojo.
const GRID32 = 0xffff6b2f, MER32 = 0xff481de1;
function paintGrid(buf, w, h) {
  const t = w > W / 2 ? 3 : 2;
  for (let k = 1; k < 6; k++) for (let d = 0; d < t; d++) { const r = Math.round(h * k / 6) + d - 1; buf.fill(GRID32, r * w, r * w + w); }
  for (let k = 0; k < 12; k++) {
    const x0 = Math.round(w * k / 12), col = k === 3 ? MER32 : GRID32;
    for (let d = 0; d < t; d++) for (let j = 0; j < h; j++) buf[j * w + (x0 + d - 1 + w) % w] = col;
  }
}

// Resaltado temporal (selección ~1 s, o panel bajo el cursor): sólo en pantalla, no queda en los colores.
const TINT = [255, 196, 60]; // ámbar: se nota tanto sobre paneles blancos como negros
const lighten = c => '#' + [1, 3, 5].map((i, q) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.55 + TINT[q] * 0.45).toString(16).padStart(2, '0')).join('');
function select(i) {
  state.sel = i; refreshPanels();
  flash = i; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = -1; repaint(); }, 1000);
  repaint();
}

// low = true: pinta a 1024x512 y a los 250 ms sin cambios repinta a 2048x1024.
function repaint(low = false) {
  clearTimeout(timer);
  if (low) timer = setTimeout(() => repaint(), 250);
  lowQ = low;
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const lo = lowQ, buf = lo ? lowPx : px, w = lo ? W / 2 : W, h = lo ? H / 2 : H;
    const cols = colors().map((c, i) => (i === flash || i === state.hl ? lighten(c) : c));
    paintBase(lo ? lowMap : map, cols, state.seam, state.thick * Math.PI / 360, buf);
    if (state.im) paintDecals(buf, w, h, { frames: frames(state.count, state.lon, state.lat), im: state.im, size: state.size, rot: state.rot });
    cur = { buf, w, h };
    drawPlane(true); // antes de la grilla 3D: el plano dibuja la suya
    if (state.grid) paintGrid(buf, w, h);
    if (lo) { lctx.putImageData(lowData, 0, 0); fctx.drawImage(lowC, 0, 0, W, H); } // el canvas del 3D mantiene 2048x1024
    else fctx.putImageData(imgData, 0, 0);
    tex.needsUpdate = true; needRender = true;
  });
}

function refreshPanels() {
  renderChips(colors(), state.sel, select);
}

function setTemplate() {
  map = buildMap(state.tpl, state.n); // costoso (~0,3 s): sólo al cambiar plantilla o gajos
  lowMap = halve(map);
  state.sel = Math.min(state.sel, colors().length - 1);
  $('gajosRow').hidden = state.tpl !== 'gajos';
  renderTemplates(TEMPLATES, state.tpl, id => { state.tpl = id; setTemplate(); });
  refreshPanels(); repaint();
}

// ---- Three.js ----
const gl = $('gl'), viewer = $('viewer');
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 0.5, 4.6);
scene.add(camera);

const tex = new THREE.CanvasTexture(flat);
tex.colorSpace = THREE.SRGBColorSpace;
tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48),
  new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0, envMapIntensity: 0.55 }));
scene.add(ball);

// Luces: todas acompañan a la cámara, así ningún lado queda siempre oscuro al rotar.
// La principal sale algo desplazada del eje de la cámara para conservar el volumen.
scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b9c4, 0.85));
const head = new THREE.DirectionalLight(0xffffff, 1.5); head.position.set(1.8, 2.2, 3); camera.add(head);
const fill = new THREE.DirectionalLight(0xdce6ff, 0.55); fill.position.set(-3, -1.5, 1.5); camera.add(fill);

// Cursor sincronizado en la esfera
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
marker.visible = false; scene.add(marker);

// Sombra de contacto: plano con gradiente radial bajo la pelota (sin shadow maps)
const sc = document.createElement('canvas'); sc.width = sc.height = 128;
const sg = sc.getContext('2d'), grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,.18)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.01; scene.add(shadow);

const controls = new OrbitControls(camera, gl);
controls.enablePan = false; controls.enableDamping = true;
controls.minDistance = 2.4; controls.maxDistance = 9;

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cuida el rendimiento en celulares
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // en vertical angosto, ensancha el fov para que la pelota entre a lo ancho
  camera.fov = 2 * Math.atan(Math.tan(35 * Math.PI / 360) / Math.min(1, camera.aspect)) * 180 / Math.PI;
  camera.updateProjectionMatrix(); needRender = true;
}
new ResizeObserver(resize).observe(viewer);

renderer.setAnimationLoop(() => {
  if (controls.update()) needRender = true;
  if (needRender) { renderer.render(scene, camera); needRender = false; }
});

// ---- Interacción: tocar = elegir panel, arrastrar sobre la imagen = moverla (esfera y plano) ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hit(e) {
  const r = gl.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObject(ball)[0];
  return h ? h.point.clone().normalize() : null; // la pelota no rota: mundo = objeto
}
// evento sobre el plano -> {x, y (px del plano), p (dirección 3D o null fuera de la pelota)}
function planeHit(e) {
  const r = pcv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * PW, y = (e.clientY - r.top) / r.height * PH;
  const q = plane.inv(x, y);
  return { x, y, p: q ? toDir(q[0], q[1]) : null, k: PW / r.width };
}

const lonS = bindRange('lon', v => { state.lon = v; repaint(true); });
const latS = bindRange('lat', v => { state.lat = v; repaint(true); });
const sizeS = bindRange('size', v => { state.size = v; repaint(true); });
const rotS = bindRange('rot', v => { state.rot = v; repaint(true); });

function overDecal(p) {
  const lim = Math.cos(Math.min(state.size / 2, 80) * D2R);
  return frames(state.count, state.lon, state.lat).some(f => p.x * f.c[0] + p.y * f.c[1] + p.z * f.c[2] > lim);
}

// Arrastrar las asas: el puntero se pasa al plano tangente del primer calco (gnomónico) y de ahí salen tamaño/rotación.
function dragHandle(which, p) {
  const f = frames(state.count, state.lon, state.lat)[0], dc = p.x * f.c[0] + p.y * f.c[1] + p.z * f.c[2];
  if (dc < 0.05) return;
  const u = (p.x * f.e1[0] + p.y * f.e1[1] + p.z * f.e1[2]) / dc, v = (p.x * f.e2[0] + p.y * f.e2[1] + p.z * f.e2[2]) / dc;
  if (which === 'scale') {
    const M = Math.max(state.im.w, state.im.h), half = Math.hypot(u, v) * M / Math.hypot(state.im.w, state.im.h);
    state.size = Math.round(Math.max(10, Math.min(120, 2 * Math.atan(half) / D2R))); sizeS.set(state.size);
  } else {
    state.rot = Math.round(Math.atan2(-u, v) / D2R); rotS.set(state.rot);
  }
  repaint(true);
}

let g = null;
function begin(src, e, p, ph) {
  g = { src, x: e.clientX, y: e.clientY, p, moved: false, drag: false, handle: null };
  if (ph) for (const name of ['scale', 'rot']) {
    const h = handles[name];
    if (h && Math.hypot(h[0] - ph.x, h[1] - ph.y) < 10 * ph.k) g.handle = name;
  }
  if (!g.handle && p && state.im && overDecal(p)) {
    g.drag = true; g.dl = state.lon - lonOf(p); g.dt = state.lat - latOf(p);
    if (src === 'sphere') controls.enabled = false;
  }
}
// en captura, para correr antes que OrbitControls y poder desactivarlo
viewer.addEventListener('pointerdown', e => { if (e.target === gl) begin('sphere', e, hit(e)); }, true);
pcv.addEventListener('pointerdown', e => { const ph = planeHit(e); begin('plane', e, ph.p, ph); });

window.addEventListener('pointermove', e => {
  if (!g) return;
  if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) g.moved = true;
  const p = g.src === 'plane' ? planeHit(e).p : hit(e);
  if (!p) return;
  if (g.handle) return dragHandle(g.handle, p);
  if (!g.drag) return;
  state.lon = Math.round(((lonOf(p) + g.dl + 540) % 360) - 180);
  state.lat = Math.round(Math.max(-90, Math.min(90, latOf(p) + g.dt)));
  lonS.set(state.lon); latS.set(state.lat); repaint(true);
});
window.addEventListener('pointerup', () => {
  if (g && !g.moved && !g.drag && !g.handle && g.p) select(panelAt(state.tpl, state.n, g.p.x, g.p.y, g.p.z));
  if (g?.drag || g?.handle) repaint(); // al soltar: resolución completa
  controls.enabled = true; g = null;
});

// Cursor sincronizado + panel bajo el cursor resaltado en ambas vistas
function setHover(p) {
  state.hover = p; marker.visible = !!p; needRender = true;
  if (p) marker.position.copy(p).multiplyScalar(1.012);
  const id = p ? panelAt(state.tpl, state.n, p.x, p.y, p.z) : -1;
  if (id !== state.hl) { state.hl = id; repaint(true); } else drawPlane(false);
}
gl.addEventListener('pointermove', e => { if (!g) setHover(hit(e)); });
gl.addEventListener('pointerleave', () => setHover(null));
pcv.addEventListener('pointermove', e => { if (!g) setHover(planeHit(e).p); });
pcv.addEventListener('pointerleave', () => setHover(null));

// ---- Controles ----
function setColor(c) { colors()[state.sel] = c; refreshPanels(); repaint(true); }
initSheet();
initPalette(setColor);
bindRange('gajos', v => { state.n = v; $('gajosOut').textContent = v; setTemplate(); });
$('gajosOut').textContent = state.n;
$('seamColor').oninput = e => { state.seam = e.target.value; repaint(true); };
bindRange('thick', v => { state.thick = v; repaint(true); });

function setView() {
  const v = $('viewKind').value;
  $('viewN').hidden = v !== 'gajos';
  plane.setMode(v === 'rect' ? 'rect' : 'sin', v === 'gajos' ? +$('viewN').value : 1);
  repaint();
}
$('viewKind').onchange = setView;
$('viewN').onchange = setView;
$('grid').onchange = e => { state.grid = e.target.checked; repaint(); };

$('file').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f), img = new Image(); // sólo en memoria del navegador
  img.onload = () => { state.im = prepareImage(img); URL.revokeObjectURL(url); $('remove').disabled = false; repaint(); };
  img.onerror = () => { URL.revokeObjectURL(url); alert('No pudimos abrir esa imagen. Probá con JPG, PNG o WebP.'); };
  img.src = url;
};
$('remove').onclick = () => { state.im = null; $('remove').disabled = true; repaint(); };
const setCount = d => { state.count = Math.max(1, Math.min(6, state.count + d)); $('count').textContent = state.count; repaint(); };
$('less').onclick = () => setCount(-1);
$('more').onclick = () => setCount(1);

setTemplate();
