// Helpers de interfaz: sólo DOM, sin conocer Three.js ni la matemática de la pelota.

export const $ = id => document.getElementById(id);

const QUICK = ['#f5f2ea', '#1c1c1c', '#d62828', '#2563eb', '#16a34a', '#facc15', '#f97316', '#7c3aed', '#ec4899', '#75aadb'];

/** Bottom sheet colapsable en móvil (en escritorio el botón está oculto). */
export function initSheet() {
  const sheet = $('sheet'), btn = $('handle');
  btn.onclick = () => { btn.setAttribute('aria-expanded', sheet.classList.toggle('open')); };
}

/** Slider con su valor mostrado en el <output> del label. */
export function bindRange(id, onInput) {
  const el = $(id), out = el.parentElement.querySelector('output');
  const show = () => { if (out) out.textContent = el.value + (el.dataset.unit || ''); };
  el.oninput = () => { show(); onInput(+el.value); };
  show();
  return { set(v) { el.value = v; show(); } };
}

export function renderTemplates(templates, current, onPick) {
  const box = $('templates'); box.innerHTML = '';
  for (const [id, t] of Object.entries(templates)) {
    const b = document.createElement('button');
    b.className = 'tpl'; b.textContent = t.name; b.setAttribute('aria-pressed', id === current);
    b.onclick = () => onPick(id);
    box.append(b);
  }
}

export function renderChips(colors, sel, onPick) {
  const box = $('chips'); box.innerHTML = '';
  colors.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.style.background = c; b.textContent = i + 1;
    b.setAttribute('aria-pressed', i === sel); b.setAttribute('aria-label', 'Panel ' + (i + 1));
    b.onclick = () => onPick(i);
    box.append(b);
  });
  $('panelColor').value = colors[sel];
}

export function initPalette(onColor) {
  const box = $('palette');
  for (const c of QUICK) {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = c; b.setAttribute('aria-label', 'Color ' + c);
    b.onclick = () => onColor(c);
    box.append(b);
  }
  $('panelColor').oninput = e => onColor(e.target.value);
}
