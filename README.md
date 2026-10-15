# Pelotas Matute

Visor 3D de pelota personalizable. HTML + CSS + JS vanilla con Three.js r160 (MIT, local en `vendor/`, sin CDN). Sin build ni backend; las imágenes se procesan en el navegador y no se suben a ningún lado.

## Probar local

Los módulos ES necesitan un servidor (no abre con doble clic):

```bash
python -m http.server 8000
```

Abrí http://localhost:8000.

## Publicar gratis

Subí la carpeta tal cual (no hay build):

- **Netlify**: arrastrá la carpeta a https://app.netlify.com/drop
- **Cloudflare Pages**: *Create project → Direct upload* y subí la carpeta.
- **GitHub Pages**: subí los archivos a un repo, *Settings → Pages → Deploy from branch*.

## Estructura

- `js/templates.js` — plantillas y Voronoi esférico por texel (textura 2048x1024).
- `js/decals.js` — proyección gnomónica de las imágenes y su distribución.
- `vendor/` — three.module.js, OrbitControls.js, RoomEnvironment.js y licencia.
- `js/ui.js` — helpers de DOM. `js/main.js` — escena Three.js y conexión de todo.

Para sumar un flujo de pedido: el estado vive en `state` y `colorsByKey` de `main.js`.
