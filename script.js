(() => {
  "use strict";

  // ---------- Fuentes ----------

  const NCS_ITEM = "274_Song_NCS_ultimate_mix";
  const NCS_META = `https://archive.org/metadata/${NCS_ITEM}`;
  // URL estable: archive.org redirige al servidor que tenga el archivo hoy
  const NCS_BASE = `https://archive.org/download/${NCS_ITEM}/`;

  // Favoritas: van primero y sirven de respaldo si el catálogo no responde
  const NCS_PINNED = [
    "Alan Walker - Spectre [NCS Release].mp3",
    "Alan Walker - Force.mp3",
    "Disfigure - Blank [NCS Release].mp3",
    "Disfigure - Blank VIP (feat. Tara Louise) [NCS Release].mp3",
    "JJD - Adventure [NCS Release].mp3",
    "Mendum - Stay With Me [NCS Release].mp3",
    "Cartoon - On & On (feat. Daniel Levi) [NCS Release].mp3"
  ];

  // Extensión -> tipo MIME. Las que el navegador no sepa reproducir se reportan
  const AUDIO_TYPES = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: 'audio/ogg; codecs="opus"',
    wav: "audio/wav",
    flac: "audio/flac",
    webm: "audio/webm",
    weba: "audio/webm",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    wma: "audio/x-ms-wma",
    ape: "audio/ape"
  };

  // ---------- Almacenamiento local (opcional, tolerante a fallos) ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("ncs-player:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("ncs-player:" + key, JSON.stringify(value));
      } catch {}
    }
  };

  const cachedDurations = store.get("durations", {});

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const el = {
    path: $("src-path"),
    count: $("track-count"),
    total: $("total-time"),
    visible: $("visible-count"),
    status: $("status"),
    index: $("now-index"),
    title: $("now-title"),
    artist: $("now-artist"),
    meta: $("now-meta"),
    canvas: $("viz"),
    readout: $("viz-readout"),
    vizMode: $("viz-mode"),
    seek: $("seek"),
    tCur: $("time-current"),
    tTot: $("time-total"),
    play: $("btn-play"),
    prev: $("btn-prev"),
    next: $("btn-next"),
    shuffle: $("btn-shuffle"),
    repeat: $("btn-repeat"),
    volume: $("volume"),
    volValue: $("vol-value"),
    library: $("library"),
    srcNcs: $("src-ncs"),
    srcLocal: $("src-local"),
    open: $("btn-open"),
    picker: $("picker"),
    notice: $("notice"),
    filter: $("filter"),
    list: $("playlist")
  };

  // ---------- Estado ----------

  // Dos listas: la que se VE (view) y la que SUENA (queue). Puedes mirar
  // la SD mientras sigue sonando NCS, y al elegir una pista cambia la cola.
  const sources = { ncs: [], local: [] };
  let localRoot = "";

  const state = {
    view: "ncs",
    queue: "ncs",
    current: -1,
    shuffle: store.get("shuffle", false),
    repeat: store.get("repeat", "off"), // off | all | one
    order: [],
    seeking: false,
    history: [],
    errorStreak: 0,
    collapsed: new Set(),
    lastVolume: 80
  };

  const queue = () => sources[state.queue];
  const view = () => sources[state.view];

  // ---------- Utilidades ----------

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  function fmt(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${pad(m)}:${pad(s)}`;
  }

  function fmtLong(sec) {
    if (sec < 60) return Math.round(sec) + "s";
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
  }

  function fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1e3)) + " KB";
  }

  function setRangeFill(input) {
    const min = +input.min || 0;
    const max = +input.max || 100;
    const p = ((+input.value - min) / (max - min)) * 100;
    input.style.setProperty("--p", p + "%");
  }

  function setStatus(s) {
    el.status.textContent = s;
    el.status.dataset.state = s;
  }

  let noticeTimer = 0;
  function notice(msg, sticky = false) {
    clearTimeout(noticeTimer);
    el.notice.textContent = msg;
    el.notice.hidden = !msg;
    if (msg && !sticky) noticeTimer = setTimeout(() => (el.notice.hidden = true), 8000);
  }

  // "01 - Artista - Título [NCS Release] (1).mp3" -> { artist, title }
  function parseName(name, fallbackArtist) {
    const s = name
      .replace(/\.[^.]+$/, "")
      .replace(/\s*\[NCS Release\]/i, "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/_/g, " ")
      .replace(/^(?:\d{1,2}[-.]?)?\d{1,3}\s*[-._)]\s+|^0\d\s+/, "") // nº de pista
      .replace(/\s+/g, " ")
      .trim();
    const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m
      ? { artist: m[1], title: m[2] }
      : { artist: fallbackArtist || "desconocido", title: s || name };
  }

  // ---------- Catálogo NCS ----------

  async function loadNcs() {
    let files;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(NCS_META, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      files = data.files
        .filter((f) => /\.mp3$/i.test(f.name))
        .map((f) => ({ name: f.name, size: +f.size || null, length: +f.length || null }));
    } catch (err) {
      console.warn("[ncs-player] catálogo no disponible:", err);
      notice("catálogo de archive.org no disponible: usando lista mínima");
      files = NCS_PINNED.map((name) => ({ name }));
    }

    const seen = new Set();
    const list = [];
    for (const f of files) {
      const p = parseName(f.name, "NCS");
      const dedupe = (p.artist + "|" + p.title).toLowerCase();
      if (seen.has(dedupe)) continue; // el ítem trae copias "(1)", "(2)"
      seen.add(dedupe);
      list.push({
        key: f.name,
        ...p,
        folder: "",
        ext: "mp3",
        size: f.size || null,
        duration: f.length || cachedDurations[f.name] || null,
        url: NCS_BASE + encodeURIComponent(f.name),
        error: false
      });
    }

    const rank = (k) => {
      const i = NCS_PINNED.indexOf(k);
      return i === -1 ? Infinity : i;
    };
    list.sort(
      (a, b) =>
        rank(a.key) - rank(b.key) ||
        collator.compare(a.artist + " " + a.title, b.artist + " " + b.title)
    );
    return list;
  }

  // ---------- Carpetas locales (SD, USB, disco) ----------

  // Arrastrar una carpeta: recorre el árbol con la API de entries
  async function filesFromDrop(dt) {
    // Hay que leer los entries ANTES del primer await: el DataTransfer caduca
    const entries = [...dt.items]
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!entries.length) {
      return [...dt.files].map((file) => ({ file, path: file.name }));
    }

    const out = [];
    async function walk(entry) {
      if (entry.name.startsWith(".")) return; // .Trashes, .Spotlight-V100, ._x.mp3
      if (entry.isFile) {
        try {
          const file = await new Promise((ok, ko) => entry.file(ok, ko));
          out.push({ file, path: entry.fullPath.replace(/^\//, "") });
        } catch {}
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          // readEntries devuelve lotes de ~100: hay que llamarlo hasta vaciar
          batch = await new Promise((ok, ko) => reader.readEntries(ok, ko));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e);
    return out;
  }

  function buildLocal(items) {
    const firsts = new Set(items.map((it) => it.path.split("/")[0]));
    const sharedRoot = firsts.size === 1 && items.some((it) => it.path.includes("/"));
    const root = sharedRoot ? [...firsts][0] : "local";

    const list = [];
    const skipped = {};
    const folders = new Set();

    for (const { file, path } of items) {
      const parts = path.split("/");
      const name = parts.pop();
      if (name.startsWith(".") || parts.some((p) => p.startsWith("."))) continue;
      const ext = (name.match(/\.([^.]+)$/) || [])[1];
      const type = ext && AUDIO_TYPES[ext.toLowerCase()];
      if (!type) continue; // carátulas, .txt, .nfo…
      if (!audio.canPlayType(type)) {
        skipped[ext.toLowerCase()] = (skipped[ext.toLowerCase()] || 0) + 1;
        continue;
      }
      const folder = (sharedRoot ? parts.slice(1) : parts).join("/");
      folders.add(folder);
      const p = parseName(name, parts[parts.length - 1]);
      list.push({
        key: path,
        ...p,
        folder,
        ext: ext.toLowerCase(),
        size: file.size,
        duration: null,
        file,
        error: false
      });
    }

    list.sort(
      (a, b) => collator.compare(a.folder, b.folder) || collator.compare(a.key, b.key)
    );
    return { list, root, skipped, folders: folders.size };
  }

  function openLocal(items) {
    if (!items.length) return notice("la carpeta está vacía");
    const { list, root, skipped, folders } = buildLocal(items);
    const skippedTxt = Object.entries(skipped)
      .map(([ext, n]) => `${n} .${ext}`)
      .join(", ");

    if (!list.length) {
      return notice(
        `${root}: no hay audio reproducible` +
          (skippedTxt ? ` (omitidos: ${skippedTxt})` : "")
      );
    }

    // Si la SD anterior estaba sonando, la pista sigue pero la cola se reinicia
    if (state.queue === "local") {
      state.current = -1;
      state.history = [];
      state.order = [];
    }
    sources.local = list;
    localRoot = root;
    state.collapsed.clear();
    el.srcLocal.textContent = root;
    el.srcLocal.title = `Carpeta local: ${root}`;
    el.srcLocal.hidden = false;
    setView("local");

    notice(
      `${root}: ${list.length} pista${list.length === 1 ? "" : "s"} en ` +
        `${folders} carpeta${folders === 1 ? "" : "s"}` +
        (skippedTxt ? ` · omitidos ${skippedTxt} (formato no soportado)` : "") +
        " · los archivos no salen de tu equipo"
    );
    scanDurations(list);
  }

  el.open.addEventListener("click", () => el.picker.click());
  el.picker.addEventListener("change", () => {
    const items = [...el.picker.files].map((file) => ({
      file,
      path: file.webkitRelativePath || file.name
    }));
    el.picker.value = "";
    openLocal(items);
  });

  // Arrastrar y soltar en cualquier parte de la página
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    el.library.classList.add("is-drop");
  });
  document.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      el.library.classList.remove("is-drop");
    }
  });
  document.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.library.classList.remove("is-drop");
    notice("leyendo carpeta…", true);
    openLocal(await filesFromDrop(e.dataTransfer));
  });

  // Duraciones de archivos locales: se leen en segundo plano, de a uno
  let scanToken = 0;
  async function scanDurations(list) {
    const token = ++scanToken;
    const probe = new Audio();
    probe.preload = "metadata";
    probe.muted = true;

    for (let i = 0; i < list.length; i++) {
      if (token !== scanToken) return; // se abrió otra carpeta
      const t = list[i];
      if (t.duration) continue;
      const url = URL.createObjectURL(t.file);
      t.duration = await new Promise((resolve) => {
        const done = (v) => {
          clearTimeout(timer);
          probe.onloadedmetadata = probe.onerror = null;
          resolve(v);
        };
        const timer = setTimeout(() => done(null), 5000);
        probe.onloadedmetadata = () => done(isFinite(probe.duration) ? probe.duration : null);
        probe.onerror = () => done(null);
        probe.src = url;
      });
      URL.revokeObjectURL(url);
      if (sources[state.view] === list) {
        const row = rowAt(i);
        if (row) row.querySelector(".track-dur").textContent = fmt(t.duration);
      }
      if (i % 20 === 19) renderTotals();
    }
    probe.removeAttribute("src");
    probe.load();
    renderTotals();
  }

  // ---------- Playlist ----------

  function setView(name) {
    state.view = name;
    el.srcNcs.setAttribute("aria-pressed", name === "ncs");
    el.srcLocal.setAttribute("aria-pressed", name === "local");
    el.path.textContent = name === "ncs" ? "~/music/ncs" : "/" + localRoot;
    renderList();
  }

  el.srcNcs.addEventListener("click", () => setView("ncs"));
  el.srcLocal.addEventListener("click", () => setView("local"));

  function renderTotals() {
    const list = view();
    let sum = 0;
    let unknown = 0;
    for (const t of list) t.duration ? (sum += t.duration) : unknown++;
    el.count.textContent = list.length;
    el.total.textContent = sum ? (unknown ? "≥ " : "") + fmtLong(sum) : "--";
  }

  function renderList() {
    const list = view();
    el.list.textContent = "";
    const frag = document.createDocumentFragment();
    const w = Math.max(2, String(list.length).length);
    const grouped = list.some((t) => t.folder);
    const perFolder = {};
    if (grouped) list.forEach((t) => (perFolder[t.folder] = (perFolder[t.folder] || 0) + 1));

    let folder = null;
    list.forEach((t, i) => {
      if (grouped && t.folder !== folder) {
        folder = t.folder;
        const g = document.createElement("li");
        g.className = "group";
        g.tabIndex = 0;
        g.dataset.folder = folder;
        g.setAttribute("aria-expanded", !state.collapsed.has(folder));
        g.innerHTML = `<span class="group-caret" aria-hidden="true"></span><span class="group-name"></span><span class="group-count">${perFolder[folder]}</span>`;
        g.querySelector(".group-name").textContent = (folder || ".") + "/";
        frag.appendChild(g);
      }
      const li = document.createElement("li");
      li.className = "track";
      li.tabIndex = 0;
      li.dataset.index = i;
      li.dataset.folder = t.folder;
      li.innerHTML = `
        <span class="track-num">${pad(i + 1, w)}</span>
        <span class="track-main">
          <span class="track-title"></span>
          <span class="track-artist"></span>
        </span>
        <span class="track-dur">${fmt(t.duration)}</span>`;
      li.querySelector(".track-title").textContent = t.title;
      li.querySelector(".track-artist").textContent = t.artist;
      li.title = t.folder ? `${t.folder}/${t.title}` : `${t.artist} — ${t.title}`;
      if (t.error) li.classList.add("has-error");
      frag.appendChild(li);
    });

    if (!list.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "cargando catálogo…";
      frag.appendChild(empty);
    }

    el.list.appendChild(frag);
    el.list.scrollTop = 0;
    renderTotals();
    applyVisibility();
    if (state.view === state.queue && state.current !== -1) highlightRow(state.current);
  }

  function rowAt(i) {
    return el.list.querySelector(`.track[data-index="${i}"]`);
  }

  // Filtro + carpetas plegadas. Al buscar se ignoran los pliegues.
  function applyVisibility() {
    const list = view();
    const q = el.filter.value.trim().toLowerCase();
    let visible = 0;
    const folderHasMatch = new Set();

    list.forEach((t, i) => {
      const row = rowAt(i);
      if (!row) return;
      const match = !q || `${t.artist} ${t.title} ${t.folder}`.toLowerCase().includes(q);
      if (match) {
        visible++;
        folderHasMatch.add(t.folder);
      }
      row.hidden = !match || (!q && state.collapsed.has(t.folder));
    });
    el.list.querySelectorAll(".group").forEach((g) => {
      g.hidden = !folderHasMatch.has(g.dataset.folder);
    });

    let empty = el.list.querySelector(".empty");
    if (list.length && !visible && !empty) {
      empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "sin coincidencias";
      el.list.appendChild(empty);
    } else if (list.length && visible && empty) {
      empty.remove();
    }
    el.visible.textContent = visible === list.length ? "" : `${visible} / ${list.length}`;
  }

  el.filter.addEventListener("input", applyVisibility);

  function toggleGroup(g) {
    const f = g.dataset.folder;
    state.collapsed.has(f) ? state.collapsed.delete(f) : state.collapsed.add(f);
    g.setAttribute("aria-expanded", !state.collapsed.has(f));
    applyVisibility();
  }

  function highlightRow(i) {
    el.list.querySelectorAll(".track.is-active").forEach((r) => {
      r.classList.remove("is-active");
      r.removeAttribute("aria-current");
    });
    if (state.view !== state.queue) return;
    const row = rowAt(i);
    if (row) {
      row.classList.add("is-active");
      row.setAttribute("aria-current", "true");
      if (!row.hidden) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // Elegir una pista de la lista visible: esa lista pasa a ser la cola
  function pick(i) {
    state.errorStreak = 0;
    if (state.queue !== state.view) {
      state.queue = state.view;
      state.current = -1;
      state.history = [];
      state.order = [];
    }
    loadTrack(i, true);
  }

  el.list.addEventListener("click", (e) => {
    const g = e.target.closest(".group");
    if (g) return toggleGroup(g);
    const row = e.target.closest(".track");
    if (row) pick(+row.dataset.index);
  });

  el.list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".track, .group");
    if (!row) return;
    if (e.key === "Enter" || (e.key === " " && row.classList.contains("group"))) {
      e.preventDefault();
      e.stopPropagation();
      row.classList.contains("group") ? toggleGroup(row) : pick(+row.dataset.index);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Dentro de la lista las flechas navegan; fuera controlan el volumen
      e.preventDefault();
      e.stopPropagation();
      const rows = [...el.list.querySelectorAll(".track:not([hidden]), .group:not([hidden])")];
      const k = rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1);
      if (rows[k]) rows[k].focus();
    }
  });

  // ---------- Audio graph + visualizador ----------

  let ctx = null,
    analyser = null,
    freqData = null,
    timeData = null;

  function initAudioGraph() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Float32Array(analyser.fftSize);
    } catch (err) {
      console.warn("[ncs-player] visualizador desactivado:", err);
      analyser = null;
    }
  }

  const viz = el.canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const COLOR_ACCENT = cssVar("--accent", "#38c2ff");
  const COLOR_GRID = cssVar("--line", "#252a31");
  const COLOR_DIM = cssVar("--dim", "#545b65");
  const COLOR_TEXT = cssVar("--text", "#d3d7dd");
  const BG_FADE = fade(cssVar("--bg", "#0e1013"), 0.32);

  // "#0e1013" -> "rgba(14,16,19,a)": pintar el fondo semitransparente deja estela
  function fade(hex, a) {
    const n = parseInt(hex.replace("#", ""), 16);
    return isNaN(n) ? `rgba(14,16,19,${a})` : `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = el.canvas.getBoundingClientRect();
    el.canvas.width = Math.round(width * dpr);
    el.canvas.height = Math.round(height * dpr);
    viz.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!rafId) draw();
  }

  // Dos vistas: "scan" (el espectro como el barrido de un LiDAR) y "fft" (barras)
  let vizMode = store.get("viz", "scan") === "fft" ? "fft" : "scan";
  el.vizMode.textContent = vizMode;

  function toggleViz() {
    vizMode = vizMode === "scan" ? "fft" : "scan";
    store.set("viz", vizMode);
    el.vizMode.textContent = vizMode;
    if (!rafId) draw();
  }
  el.vizMode.addEventListener("click", toggleViz);
  el.canvas.addEventListener("click", toggleViz);

  const BARS = 48;
  const RAYS = 72; // rayos por lado en la vista scan
  const peaks = new Float32Array(BARS);
  let rafId = 0;
  let frame = 0;

  // Solo anima mientras suena; en pausa pinta un cuadro estático y se detiene
  function startViz() {
    if (!rafId) rafId = requestAnimationFrame(draw);
  }

  function draw() {
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    const active = analyser && !audio.paused;
    if (active) analyser.getByteFrequencyData(freqData);
    // Usa ~70% inferior del espectro (lo agudo extremo casi no tiene energía)
    const usable = freqData ? Math.floor(freqData.length * 0.7) : 0;

    if (vizMode === "scan") drawScan(w, h, active, usable);
    else drawBars(w, h, active, usable);

    if (!active) el.readout.textContent = "rms -- · pico --";
    else if (frame++ % 10 === 0) updateReadout();
    rafId = audio.paused ? 0 : requestAnimationFrame(draw);
  }

  function drawBars(w, h, active, usable) {
    viz.clearRect(0, 0, w, h);
    viz.strokeStyle = COLOR_GRID;
    viz.lineWidth = 1;
    for (let y = 0.25; y < 1; y += 0.25) {
      viz.beginPath();
      viz.moveTo(0, Math.round(h * y) + 0.5);
      viz.lineTo(w, Math.round(h * y) + 0.5);
      viz.stroke();
    }

    const gap = 2;
    const barW = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = 0;
      if (active) {
        const start = Math.floor((i / BARS) * usable);
        const end = Math.max(start + 1, Math.floor(((i + 1) / BARS) * usable));
        let sum = 0;
        for (let j = start; j < end; j++) sum += freqData[j];
        v = sum / (end - start) / 255;
      }
      const barH = Math.max(1, v * (h - 6));
      const x = i * (barW + gap);

      viz.fillStyle = active ? COLOR_ACCENT : COLOR_DIM;
      viz.globalAlpha = active ? 0.85 : 0.5;
      viz.fillRect(x, h - barH, barW, barH);

      peaks[i] = active ? Math.max(barH, peaks[i] - 0.8) : 0;
      if (active && peaks[i] > 2) {
        viz.globalAlpha = 0.9;
        viz.fillStyle = COLOR_TEXT;
        viz.fillRect(x, h - peaks[i] - 2, barW, 1);
      }
    }
    viz.globalAlpha = 1;
  }

  // Vista "scan": un robot (abajo, al centro) mira hacia arriba y "ve" la música
  // como un LaserScan de LiDAR: los graves al frente, los agudos hacia los lados.
  function drawScan(w, h, active, usable) {
    if (active) {
      viz.fillStyle = BG_FADE; // estela, como la persistencia de los puntos en RViz
      viz.fillRect(0, 0, w, h);
    } else {
      viz.clearRect(0, 0, w, h);
    }

    const cx = w / 2;
    const cy = h - 12;
    const R = Math.min(cx - 10, cy - 8);
    const r0 = 18;

    // Rejilla polar: tres anillos y radiales cada 30°
    viz.strokeStyle = COLOR_GRID;
    viz.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      viz.beginPath();
      viz.arc(cx, cy, r0 + ((R - r0) * k) / 3, Math.PI, 2 * Math.PI);
      viz.stroke();
    }
    for (let k = 0; k <= 6; k++) {
      const t = Math.PI + (k / 6) * Math.PI;
      viz.beginPath();
      viz.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
      viz.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
      viz.stroke();
    }

    // El robot visto desde arriba: chasis y flecha de rumbo
    viz.strokeStyle = COLOR_DIM;
    viz.strokeRect(cx - 7.5, cy - 5.5, 15, 13);
    viz.beginPath();
    viz.moveTo(cx - 4, cy - 8);
    viz.lineTo(cx, cy - 13);
    viz.lineTo(cx + 4, cy - 8);
    viz.stroke();

    // Un rayo por banda (más resolución en los graves), reflejado a ambos lados
    const dist = new Float32Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      let v = 0;
      if (active && usable) {
        const a = Math.floor(usable * (i / RAYS) ** 2);
        const b = Math.max(a + 1, Math.floor(usable * ((i + 1) / RAYS) ** 2));
        let sum = 0;
        for (let j = a; j < b; j++) sum += freqData[j];
        v = (sum / (b - a) / 255) ** 1.4;
      }
      dist[i] = r0 + 4 + v * (R - r0 - 4);
    }
    const point = (i, side) => {
      const t = -Math.PI / 2 + side * ((i + 0.5) / RAYS) * (Math.PI / 2);
      return [cx + Math.cos(t) * dist[i], cy + Math.sin(t) * dist[i]];
    };

    // Contorno tenue (la "pared" detectada) y los puntos del scan
    viz.beginPath();
    for (let i = RAYS - 1; i >= 0; i--) viz.lineTo(...point(i, -1));
    for (let i = 0; i < RAYS; i++) viz.lineTo(...point(i, 1));
    viz.strokeStyle = active ? COLOR_ACCENT : COLOR_DIM;
    viz.globalAlpha = active ? 0.3 : 0.4;
    viz.stroke();

    viz.fillStyle = active ? COLOR_ACCENT : COLOR_DIM;
    viz.globalAlpha = active ? 0.95 : 0.6;
    for (let i = 0; i < RAYS; i++) {
      for (const side of [-1, 1]) {
        const [x, y] = point(i, side);
        viz.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    viz.globalAlpha = 1;
  }

  // Nivel de salida en dBFS, como la lectura de un instrumento
  function updateReadout() {
    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const x = timeData[i];
      sum += x * x;
      if (Math.abs(x) > peak) peak = Math.abs(x);
    }
    const db = (v) => (v > 1e-5 ? (20 * Math.log10(v)).toFixed(1) : "-∞");
    el.readout.textContent = `rms ${db(Math.sqrt(sum / timeData.length))} dB · pico ${db(peak)} dB`;
  }

  // ---------- Reproducción ----------

  let objectUrl = null;
  let skipTimer = 0;

  function loadTrack(i, autoplay = false, pushHistory = true) {
    const q = queue();
    if (i < 0 || i >= q.length) return;
    clearTimeout(skipTimer);
    if (pushHistory && state.current !== -1 && state.current !== i) {
      state.history.push(state.current);
      if (state.history.length > 100) state.history.shift();
    }
    state.current = i;
    const t = q[i];

    // Archivo local -> blob URL; se libera el anterior DESPUÉS de cambiar src
    const prevUrl = objectUrl;
    objectUrl = t.file ? URL.createObjectURL(t.file) : null;
    audio.src = objectUrl || t.url;
    if (prevUrl) URL.revokeObjectURL(prevUrl);

    el.index.textContent = `${pad(i + 1, String(q.length).length)} / ${q.length}`;
    el.title.textContent = t.title;
    el.artist.textContent = t.artist;
    renderMeta(t);
    el.tCur.textContent = "00:00";
    el.tTot.textContent = fmt(t.duration);
    el.seek.value = 0;
    setRangeFill(el.seek);
    document.title = `${t.title} · ${t.artist} — ncs-player`;

    highlightRow(i);
    if (state.queue === "ncs") store.set("last", t.key);
    updateMediaSession(t);

    if (autoplay) play();
    else setStatus("ready");
  }

  // "mp3 · 9.2 MB · 307 kbps · Rock/Queen"
  function renderMeta(t) {
    const parts = [t.ext];
    if (t.size) parts.push(fmtSize(t.size));
    if (t.size && t.duration) parts.push(Math.round((t.size * 8) / t.duration / 1000) + " kbps");
    if (t.folder) parts.push(t.folder + "/");
    el.meta.textContent = parts.join(" · ");
  }

  function play() {
    if (state.current === -1) {
      if (!queue().length) return;
      loadTrack(state.shuffle ? Math.floor(Math.random() * queue().length) : 0, false);
    }
    initAudioGraph();
    setStatus("loading");
    const p = audio.play();
    if (p && p.catch)
      p.catch((err) => {
        // AbortError = se cambió de pista; si hay audio.error, ya lo reporta el evento "error"
        if (err.name === "AbortError" || audio.error) return;
        console.warn(err);
        setStatus("paused");
      });
  }

  function togglePlay() {
    audio.paused ? play() : audio.pause();
  }

  function shuffled(n, first) {
    const a = [];
    for (let i = 0; i < n; i++) if (i !== first) a.push(i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (first >= 0) a.unshift(first);
    return a;
  }

  // Aleatorio sin repetir: baraja la cola una vez y la recorre entera
  function nextIndex(wrap) {
    const n = queue().length;
    if (!n) return -1;
    if (state.shuffle) {
      if (state.order.length !== n) state.order = shuffled(n, state.current);
      const p = state.order.indexOf(state.current) + 1;
      if (p > 0 && p < n) return state.order[p];
      if (!wrap) return -1;
      state.order = shuffled(n, -1);
      if (state.order[0] === state.current && n > 1) state.order.push(state.order.shift());
      return state.order[0];
    }
    const next = state.current + 1;
    return next < n ? next : wrap ? 0 : -1;
  }

  function next(auto = false) {
    const n = nextIndex(!auto || state.repeat === "all");
    if (n === -1) {
      audio.pause();
      audio.currentTime = 0;
      setStatus(audio.error ? "error" : "end");
      return;
    }
    loadTrack(n, auto || !audio.paused);
  }

  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const n = queue().length;
    if (!n) return;
    const wasPlaying = !audio.paused;
    if (state.history.length) {
      loadTrack(state.history.pop(), wasPlaying, false);
    } else {
      loadTrack(state.current - 1 < 0 ? n - 1 : state.current - 1, wasPlaying, false);
    }
  }

  function seekBy(sec) {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
  }

  // ---------- Eventos de audio ----------

  audio.addEventListener("playing", () => {
    state.errorStreak = 0;
    setStatus("playing");
    el.play.classList.add("is-playing");
    el.play.setAttribute("aria-label", "Pausa");
    startViz();
  });

  audio.addEventListener("pause", () => {
    if (!audio.ended && !audio.error) setStatus("paused");
    el.play.classList.remove("is-playing");
    el.play.setAttribute("aria-label", "Reproducir");
  });

  audio.addEventListener("waiting", () => setStatus("buffering"));

  audio.addEventListener("loadedmetadata", () => {
    const t = queue()[state.current];
    if (!t) return;
    t.duration = audio.duration;
    el.tTot.textContent = fmt(audio.duration);
    renderMeta(t);
    if (state.view === state.queue) {
      const row = rowAt(state.current);
      if (row) row.querySelector(".track-dur").textContent = fmt(audio.duration);
    }
    if (state.queue === "ncs") {
      cachedDurations[t.key] = Math.round(audio.duration);
      store.set("durations", cachedDurations);
    }
  });

  audio.addEventListener("timeupdate", () => {
    if (state.seeking || !isFinite(audio.duration)) return;
    el.tCur.textContent = fmt(audio.currentTime);
    el.seek.value = (audio.currentTime / audio.duration) * 1000;
    setRangeFill(el.seek);
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime
        });
      } catch {}
    }
  });

  audio.addEventListener("ended", () => {
    if (state.repeat === "one") {
      audio.currentTime = 0;
      play();
      return;
    }
    next(true);
  });

  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    const t = queue()[state.current];
    if (t) {
      t.error = true;
      const row = state.view === state.queue && rowAt(state.current);
      if (row) row.classList.add("has-error");
    }
    setStatus("error");
    console.warn("[ncs-player] no se pudo cargar:", t && t.key);
    // Salta a la siguiente, evitando bucles si todo falla
    state.errorStreak++;
    if (state.errorStreak < 5) skipTimer = setTimeout(() => next(true), 1200);
  });

  // ---------- Controles ----------

  el.play.addEventListener("click", togglePlay);
  el.next.addEventListener("click", () => next(false));
  el.prev.addEventListener("click", prev);

  function renderModes() {
    el.shuffle.setAttribute("aria-pressed", state.shuffle);
    el.repeat.setAttribute("aria-pressed", state.repeat !== "off");
    el.repeat.textContent =
      state.repeat === "one" ? "RPT:1" : state.repeat === "all" ? "RPT:∞" : "RPT";
    el.repeat.title =
      state.repeat === "one"
        ? "Repetir: esta pista (R)"
        : state.repeat === "all"
        ? "Repetir: toda la lista (R)"
        : "Repetir: no (R)";
  }

  el.shuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    state.order = [];
    store.set("shuffle", state.shuffle);
    renderModes();
  });

  el.repeat.addEventListener("click", () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    store.set("repeat", state.repeat);
    renderModes();
  });

  // Barra de progreso
  el.seek.addEventListener("input", () => {
    state.seeking = true;
    setRangeFill(el.seek);
    if (isFinite(audio.duration))
      el.tCur.textContent = fmt((el.seek.value / 1000) * audio.duration);
  });
  el.seek.addEventListener("change", () => {
    if (isFinite(audio.duration)) audio.currentTime = (el.seek.value / 1000) * audio.duration;
    state.seeking = false;
  });

  // Volumen
  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    audio.volume = v / 100;
    el.volume.value = v;
    el.volValue.textContent = v;
    setRangeFill(el.volume);
    store.set("volume", v);
  }
  el.volume.addEventListener("input", () => setVolume(+el.volume.value));

  function toggleMute() {
    const v = +el.volume.value;
    if (v > 0) {
      state.lastVolume = v;
      setVolume(0);
    } else {
      setVolume(state.lastVolume || 80);
    }
  }

  // ---------- Teclado ----------

  document.addEventListener("keydown", (e) => {
    if (e.target === el.filter) {
      if (e.key === "Escape") el.filter.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    const onRange = tag === "INPUT" && e.target.type === "range";

    switch (e.key) {
      case " ":
        if (tag === "BUTTON") return;
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        if (onRange) return;
        e.preventDefault();
        seekBy(5);
        break;
      case "ArrowLeft":
        if (onRange) return;
        e.preventDefault();
        seekBy(-5);
        break;
      case "ArrowUp":
        if (onRange) return;
        e.preventDefault();
        setVolume(+el.volume.value + 5);
        break;
      case "ArrowDown":
        if (onRange) return;
        e.preventDefault();
        setVolume(+el.volume.value - 5);
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "n":
      case "N":
        next(false);
        break;
      case "p":
      case "P":
        prev();
        break;
      case "s":
      case "S":
        el.shuffle.click();
        break;
      case "r":
      case "R":
        el.repeat.click();
        break;
      case "o":
      case "O":
        el.picker.click();
        break;
      case "v":
      case "V":
        toggleViz();
        break;
      case "/":
        e.preventDefault();
        el.filter.focus();
        break;
    }
  });

  // ---------- Media Session (controles del sistema) ----------

  function updateMediaSession(t) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.folder || (state.queue === "ncs" ? "NCS Collection" : localRoot)
    });
  }

  if ("mediaSession" in navigator) {
    const handlers = {
      play,
      pause: () => audio.pause(),
      nexttrack: () => next(false),
      previoustrack: prev,
      seekbackward: (d) => seekBy(-(d.seekOffset || 10)),
      seekforward: (d) => seekBy(d.seekOffset || 10),
      seekto: (d) => {
        if (isFinite(audio.duration)) audio.currentTime = d.seekTime;
      }
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {}
    }
  }

  // ---------- Init ----------

  renderModes();
  setVolume(store.get("volume", 80));
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  setView("ncs");

  loadNcs().then((list) => {
    sources.ncs = list;
    if (state.view === "ncs") renderList();
    if (state.current === -1 && state.queue === "ncs") {
      const last = list.findIndex((t) => t.key === store.get("last", null));
      loadTrack(Math.max(0, last), false, false);
    }
  });
})();
