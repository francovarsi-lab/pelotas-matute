// Escena 3D + pegamento entre plantillas, calcos y UI.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { TEMPLATES, W, H, buildMap, halve, paintBase, panelAt, defaultColors } from './templates.js';
import { frames, prepareImage, paintDecals } from './decals.js';
import { $, initSheet, bindRange, renderTemplates, renderChips, initPalette } from './ui.js';

const state = {
  tpl: 'p32', n: 8, sel: 0, seam: '#1a1a1a', thick: 1.2,
  im: null, count: 1, size: 50, rot: 0, lon: 0, lat: 0,
};
const colorsByKey = {};
const key = () => state.tpl + (state.tpl === 'gajos' ? state.n : '');
const colors = () => (colorsByKey[key()] ??= defaultColors(state.tpl, state.n));

// ---- Textura plana (la misma canvas se muestra en el panel y se mapea a la esfera) ----
const flat = document.createElement('canvas'); flat.width = W; flat.height = H;
$('flatbox').append(flat);
const fctx = flat.getContext('2d'), imgData = fctx.createImageData(W, H), px = new Uint32Array(imgData.data.buffer);
const lowC = document.createElement('canvas'); lowC.width = W / 2; lowC.height = H / 2;
const lctx = lowC.getContext('2d'), lowData = lctx.createImageData(W / 2, H / 2), lowPx = new Uint32Array(lowData.data.buffer);
let map = null, lowMap = null, queued = false, lowQ = false, timer = 0, needRender = true, flash = -1, flashTimer = 0;

// Aclarado temporal del panel elegido: sólo en la pelota por ~1 s, no queda en la textura final.
const lighten = c => '#' + [1, 3, 5].map(i => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.55 + 255 * 0.45).toString(16).padStart(2, '0')).join('');
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
    const cols = flash >= 0 ? colors().map((c, i) => (i === flash ? lighten(c) : c)) : colors();
    paintBase(lo ? lowMap : map, cols, state.seam, state.thick * Math.PI / 360, buf);
    if (state.im) paintDecals(buf, w, h, { frames: frames(state.count, state.lon, state.lat), im: state.im, size: state.size, rot: state.rot });
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

const tex = new THREE.CanvasTexture(flat);
tex.colorSpace = THREE.SRGBColorSpace;
tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48),
  new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0 }));
scene.add(ball);

const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(2, 4, 3); scene.add(sun);

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

// ---- Interacción sobre la pelota: tocar = elegir panel, arrastrar sobre la imagen = moverla ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hit(e) {
  const r = gl.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObject(ball)[0];
  return h ? h.point.clone().normalize() : null; // la pelota no rota: mundo = objeto
}
const lonOf = p => Math.atan2(p.x, p.z) * 180 / Math.PI, latOf = p => Math.asin(Math.max(-1, Math.min(1, p.y))) * 180 / Math.PI;
const lonS = bindRange('lon', v => { state.lon = v; repaint(true); });
const latS = bindRange('lat', v => { state.lat = v; repaint(true); });

function overDecal(p) {
  const lim = Math.cos(Math.min(state.size / 2, 80) * Math.PI / 180);
  return frames(state.count, state.lon, state.lat).some(f => p.x * f.c[0] + p.y * f.c[1] + p.z * f.c[2] > lim);
}

let g = null;
// en captura, para correr antes que OrbitControls y poder desactivarlo
viewer.addEventListener('pointerdown', e => {
  if (e.target !== gl) return;
  const p = hit(e);
  g = { x: e.clientX, y: e.clientY, p, moved: false, drag: false };
  if (p && state.im && overDecal(p)) {
    g.drag = true; controls.enabled = false;
    g.dl = state.lon - lonOf(p); g.dt = state.lat - latOf(p);
  }
}, true);
window.addEventListener('pointermove', e => {
  if (!g) return;
  if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) g.moved = true;
  if (!g.drag) return;
  const p = hit(e);
  if (!p) return;
  state.lon = Math.round(((lonOf(p) + g.dl + 540) % 360) - 180);
  state.lat = Math.round(Math.max(-90, Math.min(90, latOf(p) + g.dt)));
  lonS.set(state.lon); latS.set(state.lat); repaint(true);
});
window.addEventListener('pointerup', () => {
  if (g && !g.moved && !g.drag && g.p) {
    select(panelAt(state.tpl, state.n, g.p.x, g.p.y, g.p.z));
  }
  if (g?.drag) repaint(); // al soltar: resolución completa
  controls.enabled = true; g = null;
});

// ---- Controles ----
function setColor(c) { colors()[state.sel] = c; refreshPanels(); repaint(true); }
initSheet();
initPalette(setColor);
bindRange('gajos', v => { state.n = v; $('gajosOut').textContent = v; setTemplate(); });
$('gajosOut').textContent = state.n;
$('seamColor').oninput = e => { state.seam = e.target.value; repaint(true); };
bindRange('thick', v => { state.thick = v; repaint(true); });
bindRange('size', v => { state.size = v; repaint(true); });
bindRange('rot', v => { state.rot = v; repaint(true); });

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
