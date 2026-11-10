(() => {
  "use strict";

  // ---------- Datos ----------

  const BASE_URL =
    "https://dn720306.ca.archive.org/0/items/274_Song_NCS_ultimate_mix/";

  const FILES = [
    // Prioritarias
    "Alan Walker - Spectre [NCS Release].mp3",
    "Alan Walker - Force.mp3",
    "Disfigure - Blank [NCS Release].mp3",
    "Disfigure - Blank VIP (feat. Tara Louise) [NCS Release].mp3",
    "JJD - Adventure [NCS Release].mp3",
    "Mendum - Stay With Me [NCS Release].mp3",
    "Cartoon - On & On (feat. Daniel Levi) [NCS Release].mp3",
    // Adicionales
    "Clarx, Catas, Le Malls, CHENDA, Anikdote - Numb The Pain (feat. Shiah Maisel) [NCS Release].mp3",
    "Electro-Light & Jordan Kelvin James - Wait For You (feat. Anna Yvette) [NCS Release].mp3",
    "Electro-Light - Fall For Gravity feat. Nathan Brumley [NCS Release].mp3",
    "Electro-Light - Night Shines (feat. Nathan Brumley) [NCS Release].mp3",
    "Electro-Light - Symbolism [NCS Release].mp3",
    "Electro-Light - Symbolism pt. III [NCS Release].mp3",
    "Electro-Light - Symbolism pt.II [NCS Release].mp3",
    "Electro-Light - The Ways (feat. Aloma Steele) [NCS Release].mp3",
    "Electro-Light - Throwback [NCS Release].mp3",
    "Elektronomia - Energy [NCS Release].mp3",
    "Elektronomia - Limitless [NCS Release].mp3",
    "Elektronomia - Sky High [NCS Release].mp3",
    "Elektronomia - Sky High pt.II [NCS Release].mp3",
    "ElementD & Chordinatez - Radiate (feat. Mees Van Den Berg) [NCS Release].mp3",
    "Exit Friendzone ft. Eden - Iris [NCS Release].mp3",
    "Fareoh - Cloud Ten [NCS Release].mp3",
    "Fareoh - Under Water [NCS Release].mp3",
    "Floatinurboat x Chris Linton - Holding On [NCS Release].mp3",
    "Foria - Break Away [NCS Release].mp3",
    "Futuristik - Little Bit (feat. Sethh) [NCS Release].mp3",
    "Jim Yosef, Electro-Light, Anna Yvette, Deaf Kev & Tobu - Destiny [NCS Release].mp3",
    "Jo Cohen & BQ - Glowing At Night [NCS Release].mp3",
    "Jo Cohen & Sex Whales - We Are [NCS Release].mp3",
    "John Kenza - Wicked [NCS Release].mp3",
    "Johnny Third - Young Ones (feat. Jeremy Fowler) [NCS Release].mp3"
  ];

  function parseTrack(file, id) {
    const clean = file
      .replace(/\.mp3$/i, "")
      .replace(/\s*\[NCS Release\]\s*/i, "")
      .trim();
    const cut = clean.indexOf(" - ");
    return {
      id,
      file,
      artist: cut > -1 ? clean.slice(0, cut) : "Unknown Artist",
      title: cut > -1 ? clean.slice(cut + 3) : clean,
      url: BASE_URL + encodeURIComponent(file),
      duration: null,
      error: false
    };
  }

  const tracks = FILES.map(parseTrack);

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
  tracks.forEach((t) => {
    if (cachedDurations[t.file]) t.duration = cachedDurations[t.file];
  });

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const el = {
    count: $("track-count"),
    visible: $("visible-count"),
    status: $("status"),
    index: $("now-index"),
    title: $("now-title"),
    artist: $("now-artist"),
    canvas: $("viz"),
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
    filter: $("filter"),
    list: $("playlist")
  };

  // ---------- Estado ----------

  const state = {
    current: -1,
    shuffle: store.get("shuffle", false),
    repeat: store.get("repeat", "off"), // off | all | one
    seeking: false,
    history: [],
    errorStreak: 0
  };

  // ---------- Utilidades ----------

  const pad = (n) => String(n).padStart(2, "0");

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${pad(m)}:${pad(s)}`;
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

  // ---------- Playlist ----------

  function renderPlaylist() {
    const frag = document.createDocumentFragment();
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "track";
      li.tabIndex = 0;
      li.dataset.index = i;
      li.innerHTML = `
        <span class="track-num">${pad(i + 1)}</span>
        <span class="track-main">
          <span class="track-title"></span>
          <span class="track-artist"></span>
        </span>
        <span class="track-dur">${fmt(t.duration)}</span>`;
      li.querySelector(".track-title").textContent = t.title;
      li.querySelector(".track-artist").textContent = t.artist;
      li.title = `${t.artist} — ${t.title}`;
      frag.appendChild(li);
    });
    el.list.appendChild(frag);
    el.count.textContent = tracks.length;
    updateVisibleCount(tracks.length);
  }

  function rowAt(i) {
    return el.list.querySelector(`[data-index="${i}"]`);
  }

  function updateVisibleCount(n) {
    el.visible.textContent =
      n === tracks.length ? `${n} items` : `${n} / ${tracks.length}`;
  }

  function highlightRow(i) {
    el.list
      .querySelectorAll(".track.is-active")
      .forEach((r) => r.classList.remove("is-active"));
    const row = rowAt(i);
    if (row) {
      row.classList.add("is-active");
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  el.list.addEventListener("click", (e) => {
    const row = e.target.closest(".track");
    if (row) loadTrack(+row.dataset.index, true);
  });

  el.list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".track");
    if (!row) return;
    if (e.key === "Enter") {
      e.preventDefault();
      loadTrack(+row.dataset.index, true);
    }
  });

  // Filtro
  el.filter.addEventListener("input", () => {
    const q = el.filter.value.trim().toLowerCase();
    let visible = 0;
    tracks.forEach((t, i) => {
      const match = !q || `${t.artist} ${t.title}`.toLowerCase().includes(q);
      rowAt(i).hidden = !match;
      if (match) visible++;
    });
    let empty = el.list.querySelector(".empty");
    if (!visible && !empty) {
      empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "sin coincidencias";
      el.list.appendChild(empty);
    } else if (visible && empty) {
      empty.remove();
    }
    updateVisibleCount(visible);
  });

  // ---------- Audio graph + visualizador ----------

  let ctx = null,
    analyser = null,
    freqData = null;

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
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn("[ncs-player] visualizador desactivado:", err);
      analyser = null;
    }
  }

  const viz = el.canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const COLOR_ACCENT = css.getPropertyValue("--accent").trim() || "#d6a556";
  const COLOR_GRID = css.getPropertyValue("--line").trim() || "#252a31";
  const COLOR_DIM = css.getPropertyValue("--dim").trim() || "#545b65";

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = el.canvas.getBoundingClientRect();
    el.canvas.width = Math.round(width * dpr);
    el.canvas.height = Math.round(height * dpr);
    viz.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const BARS = 48;
  const peaks = new Float32Array(BARS);

  function draw() {
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    viz.clearRect(0, 0, w, h);

    // Rejilla horizontal
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
    const active = analyser && !audio.paused;
    if (active) analyser.getByteFrequencyData(freqData);

    // Usa ~70% inferior del espectro (lo agudo extremo casi no tiene energía)
    const usable = freqData ? Math.floor(freqData.length * 0.7) : 0;

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

      // Marcador de pico
      peaks[i] = Math.max(barH, peaks[i] - 0.8);
      if (active && peaks[i] > 2) {
        viz.globalAlpha = 0.9;
        viz.fillStyle = "#d3d7dd";
        viz.fillRect(x, h - peaks[i] - 2, barW, 1);
      }
    }
    viz.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  // ---------- Reproducción ----------

  function loadTrack(i, autoplay = false, pushHistory = true) {
    if (i < 0 || i >= tracks.length) return;
    if (pushHistory && state.current !== -1 && state.current !== i) {
      state.history.push(state.current);
      if (state.history.length > 100) state.history.shift();
    }
    state.current = i;
    const t = tracks[i];

    audio.src = t.url;
    audio.load();

    el.index.textContent = `${pad(i + 1)} / ${pad(tracks.length)}`;
    el.title.textContent = t.title;
    el.artist.textContent = t.artist;
    el.tCur.textContent = "00:00";
    el.tTot.textContent = fmt(t.duration);
    el.seek.value = 0;
    setRangeFill(el.seek);
    document.title = `${t.title} · ${t.artist} — ncs-player`;

    highlightRow(i);
    store.set("last", i);
    updateMediaSession(t);

    if (autoplay) play();
    else setStatus("ready");
  }

  function play() {
    if (state.current === -1) {
      loadTrack(0, false);
    }
    initAudioGraph();
    setStatus("loading");
    const p = audio.play();
    if (p && p.catch)
      p.catch((err) => {
        if (err.name !== "AbortError") {
          console.warn(err);
          setStatus("paused");
        }
      });
  }

  function togglePlay() {
    audio.paused ? play() : audio.pause();
  }

  function nextIndex() {
    if (state.shuffle && tracks.length > 1) {
      let r;
      do {
        r = Math.floor(Math.random() * tracks.length);
      } while (r === state.current);
      return r;
    }
    const n = state.current + 1;
    if (n >= tracks.length) return state.repeat === "all" ? 0 : -1;
    return n;
  }

  function next(auto = false) {
    const n = nextIndex();
    if (n === -1) {
      if (auto) {
        audio.pause();
        audio.currentTime = 0;
        setStatus("idle");
        return;
      }
      loadTrack(0, !audio.paused);
      return;
    }
    loadTrack(n, auto || !audio.paused);
  }

  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const wasPlaying = !audio.paused;
    if (state.history.length) {
      loadTrack(state.history.pop(), wasPlaying, false);
    } else {
      const p = state.current - 1 < 0 ? tracks.length - 1 : state.current - 1;
      loadTrack(p, wasPlaying, false);
    }
  }

  // ---------- Eventos de audio ----------

  audio.addEventListener("playing", () => {
    state.errorStreak = 0;
    setStatus("playing");
    el.play.classList.add("is-playing");
    el.play.setAttribute("aria-label", "Pausa");
  });

  audio.addEventListener("pause", () => {
    if (!audio.ended) setStatus("paused");
    el.play.classList.remove("is-playing");
    el.play.setAttribute("aria-label", "Reproducir");
  });

  audio.addEventListener("waiting", () => setStatus("buffering"));

  audio.addEventListener("loadedmetadata", () => {
    const t = tracks[state.current];
    if (!t) return;
    t.duration = audio.duration;
    el.tTot.textContent = fmt(audio.duration);
    const row = rowAt(state.current);
    if (row) row.querySelector(".track-dur").textContent = fmt(audio.duration);
    cachedDurations[t.file] = Math.round(audio.duration);
    store.set("durations", cachedDurations);
  });

  audio.addEventListener("timeupdate", () => {
    if (state.seeking || !isFinite(audio.duration)) return;
    el.tCur.textContent = fmt(audio.currentTime);
    el.seek.value = (audio.currentTime / audio.duration) * 1000;
    setRangeFill(el.seek);
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
    if (!audio.src) return;
    const t = tracks[state.current];
    if (t) {
      t.error = true;
      const row = rowAt(state.current);
      if (row) row.classList.add("has-error");
    }
    setStatus("error");
    console.warn("[ncs-player] no se pudo cargar:", t && t.file);
    // Salta a la siguiente, evitando bucles si todo falla
    state.errorStreak++;
    if (state.errorStreak < 5) setTimeout(() => next(true), 1200);
  });

  // ---------- Controles ----------

  el.play.addEventListener("click", togglePlay);
  el.next.addEventListener("click", () => next(false));
  el.prev.addEventListener("click", prev);

  function renderModes() {
    el.shuffle.setAttribute("aria-pressed", state.shuffle);
    el.repeat.setAttribute("aria-pressed", state.repeat !== "off");
    el.repeat.textContent =
      state.repeat === "one"
        ? "RPT:1"
        : state.repeat === "all"
        ? "RPT:∞"
        : "RPT";
  }

  el.shuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    store.set("shuffle", state.shuffle);
    renderModes();
  });

  el.repeat.addEventListener("click", () => {
    state.repeat =
      state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
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
    if (isFinite(audio.duration))
      audio.currentTime = (el.seek.value / 1000) * audio.duration;
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

  // ---------- Teclado ----------

  document.addEventListener("keydown", (e) => {
    if (e.target === el.filter) {
      if (e.key === "Escape") {
        el.filter.blur();
      }
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
        if (isFinite(audio.duration))
          audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        break;
      case "ArrowLeft":
        if (onRange) return;
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
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
      album: "NCS Collection"
    });
  }

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", play);
    ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("nexttrack", () => next(false));
    ms.setActionHandler("previoustrack", prev);
  }

  // ---------- Init ----------

  renderPlaylist();
  renderModes();
  setVolume(store.get("volume", 80));
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(draw);

  const last = store.get("last", 0);
  loadTrack(
    Number.isInteger(last) && last < tracks.length ? last : 0,
    false,
    false
  );
  setStatus("idle");
})();
