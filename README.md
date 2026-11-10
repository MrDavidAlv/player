# ncs-player

Reproductor de música web, minimalista y con estética de terminal. Escucha el catálogo de **NoCopyrightSounds** en línea o abre una carpeta de tu equipo (una memoria SD, una USB o tu carpeta de música) y escúchala al instante.

Sin frameworks, sin dependencias y sin build: solo `index.html`, `style.css` y `script.js`.

## Características

- **Catálogo NCS en línea**: más de 200 pistas desde archive.org, con su duración real.
- **Carpetas locales**: botón **cargar música** o arrastra la carpeta a la página. Agrupa por subcarpetas, ignora los archivos ocultos del sistema y nada sale de tu equipo.
- **Formatos**: mp3, m4a, aac, flac, ogg, opus, wav y webm (según el navegador).
- **Aleatorio sin repetir**, repetir lista o pista, y búsqueda por artista, título o carpeta.
- **Visualizador** con dos vistas: `scan`, el espectro dibujado como el barrido de un LiDAR (los graves al frente, los agudos a los lados), y `fft`, barras clásicas. Muestra el nivel rms y el pico en dB.
- **Controles del sistema**: teclas multimedia y pantalla de bloqueo.
- Recuerda el volumen, los modos y la última pista.

## Uso

Abre `index.html` en Chrome, Edge o Firefox. Si prefieres servirlo localmente:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

> Al abrir una carpeta, Chrome pregunta si quieres "subir" los archivos: es el aviso estándar del navegador, no se sube nada. Al recargar la página hay que volver a abrir la carpeta.

## Atajos

| Tecla | Acción |
|---|---|
| `espacio` | reproducir / pausa |
| `←` `→` | ±5 s |
| `↑` `↓` | volumen |
| `m` | silencio |
| `n` / `p` | siguiente / anterior |
| `s` / `r` | aleatorio / repetir |
| `/` | buscar |
| `o` | abrir carpeta |
| `v` | cambiar la vista del visualizador |

## Créditos

Música de [NoCopyrightSounds](https://ncs.io), servida desde [archive.org](https://archive.org/details/274_Song_NCS_ultimate_mix).
