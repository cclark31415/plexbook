const POSITION_SAVE_INTERVAL = 10000;
const ARTICLES = /^(the|a|an)\s+/i;

const state = {
  library: [],
  plexToken: null,
  plexServer: null,
  plexServerUrl: null,
  currentBook: null,
  currentTrackIndex: 0,
  tracks: [],
  audio: null,
  playing: false,
  speed: 1,
  positionTimer: null,
  positions: {},
  spectrumEnabled: false,
  analyser: null,
  audioCtx: null,
  sourceNode: null,
  animFrameId: null,
  pinPollTimer: null,
  plexLibraries: [],
  selectedLibraryKeys: [],
};

function $(id) { return document.getElementById(id); }

function sortKey(title) {
  return title.replace(ARTICLES, "").toLowerCase();
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function toast(msg, ms = 2500) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  el.classList.add("show");
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 300);
  }, ms);
}

// Persistence helpers
function savePositions() {
  localStorage.setItem("plexbook_positions", JSON.stringify(state.positions));
}

function loadPositions() {
  try {
    state.positions = JSON.parse(localStorage.getItem("plexbook_positions")) || {};
  } catch { state.positions = {}; }
}

function saveLibrary() {
  const local = state.library.filter((b) => b.source === "local");
  const serializable = local.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    source: b.source,
    trackNames: b.tracks ? b.tracks.map((t) => t.name) : [],
  }));
  localStorage.setItem("plexbook_local_library", JSON.stringify(serializable));
}

function loadLocalLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem("plexbook_local_library"));
    if (!saved) return [];
    return saved.map((b) => ({
      ...b,
      thumb: "",
      tracks: (b.trackNames || []).map((name) => ({ name, url: null })),
    }));
  } catch { return []; }
}

function savePlexAuth() {
  if (state.plexToken && state.plexServerUrl) {
    localStorage.setItem("plexbook_token", state.plexToken);
    localStorage.setItem("plexbook_server_url", state.plexServerUrl);
    localStorage.setItem("plexbook_server_name", state.plexServer?.name || "Plex Server");
    localStorage.setItem("plexbook_selected_libraries", JSON.stringify(state.selectedLibraryKeys));
  } else {
    localStorage.removeItem("plexbook_token");
    localStorage.removeItem("plexbook_server_url");
    localStorage.removeItem("plexbook_server_name");
    localStorage.removeItem("plexbook_selected_libraries");
  }
}

function loadPlexAuth() {
  state.plexToken = localStorage.getItem("plexbook_token");
  state.plexServerUrl = localStorage.getItem("plexbook_server_url");
  const name = localStorage.getItem("plexbook_server_name");
  if (state.plexToken && state.plexServerUrl) {
    state.plexServer = { name: name || "Plex Server" };
  }
  try {
    state.selectedLibraryKeys = JSON.parse(localStorage.getItem("plexbook_selected_libraries")) || [];
  } catch { state.selectedLibraryKeys = []; }
}

// Library rendering
function renderLibrary() {
  const grid = $("libraryGrid");
  const query = $("searchInput").value.toLowerCase();
  const source = $("sourceFilter").value;

  let books = state.library.slice();
  if (source !== "all") books = books.filter((b) => b.source === source);
  if (query) books = books.filter((b) => b.title.toLowerCase().includes(query) || (b.author || "").toLowerCase().includes(query));

  books.sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));

  if (books.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>${state.library.length === 0 ? "Your library is empty." : "No matching books."}</p>
      <p>${state.library.length === 0 ? "Connect a Plex server or add local files to get started." : "Try a different search."}</p></div>`;
    return;
  }

  grid.innerHTML = books.map((book) => {
    const pos = state.positions[book.id];
    const progress = pos ? Math.min(100, (pos.percent || 0) * 100) : 0;
    const artHtml = book.thumb
      ? `<img src="${book.thumb}" alt="" loading="lazy" />`
      : `<span class="placeholder-art">&#127911;</span>`;

    return `<div class="book-card" data-book-id="${book.id}">
      <div class="book-card-art">${artHtml}</div>
      <div class="book-card-info">
        <p class="book-card-title" title="${book.title}">${book.title}</p>
        <p class="book-card-author">${book.author || "Unknown"}</p>
        <span class="book-card-source">${book.source}</span>
        ${progress > 0 ? `<div class="book-card-progress"><div class="book-card-progress-fill" style="width:${progress}%"></div></div>` : ""}
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".book-card").forEach((card) => {
    card.addEventListener("click", () => openBook(card.dataset.bookId));
  });
}

// Plex authentication
async function startPlexAuth() {
  try {
    const pin = await PlexAPI.getPin();
    const authUrl = PlexAPI.getAuthUrl(pin.id, pin.code);
    window.open(authUrl, "_blank");
    toast("Complete sign-in in the Plex window...", 5000);

    let attempts = 0;
    state.pinPollTimer = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(state.pinPollTimer);
        toast("Plex sign-in timed out");
        return;
      }
      const token = await PlexAPI.checkPin(pin.id);
      if (token) {
        clearInterval(state.pinPollTimer);
        state.plexToken = token;
        await selectPlexServer();
      }
    }, 2000);
  } catch (e) {
    toast("Failed to start Plex auth: " + e.message);
  }
}

async function selectPlexServer() {
  try {
    const servers = await PlexAPI.getServers(state.plexToken);
    if (servers.length === 0) {
      toast("No Plex servers found on your account");
      return;
    }

    const server = servers[0];
    const conn = server.connections.find((c) => c.local === false) || server.connections[0];
    state.plexServer = server;
    state.plexServerUrl = conn.uri;
    savePlexAuth();
    updatePlexUI();
    toast("Connected to " + server.name);
    await showPlexLibraryPicker();
  } catch (e) {
    toast("Failed to connect to Plex: " + e.message);
  }
}

async function showPlexLibraryPicker() {
  if (!state.plexToken || !state.plexServerUrl) return;

  const list = $("plexLibraryList");
  const confirmBtn = $("plexLibraryConfirm");
  list.innerHTML = '<p class="modal-hint">Loading libraries...</p>';
  confirmBtn.disabled = true;
  $("plexLibraryModal").hidden = false;

  try {
    const allLibs = await PlexAPI.getLibraries(state.plexServerUrl, state.plexToken);
    state.plexLibraries = allLibs;

    if (allLibs.length === 0) {
      list.innerHTML = '<p class="modal-hint">No libraries found on this server.</p>';
      return;
    }

    const typeLabels = { artist: "Music", movie: "Movies", show: "TV Shows", photo: "Photos" };
    const savedKeys = state.selectedLibraryKeys;

    list.innerHTML = allLibs.map((lib) => {
      const checked = savedKeys.includes(lib.key) ? "checked" : "";
      const typeName = typeLabels[lib.type] || lib.type;
      return `<label class="plex-library-item ${checked ? "selected" : ""}" data-key="${lib.key}">
        <input type="checkbox" value="${lib.key}" ${checked} />
        <div class="plex-library-item-info">
          <div class="plex-library-item-title">${lib.title}</div>
          <div class="plex-library-item-meta">${typeName}</div>
        </div>
      </label>`;
    }).join("");

    list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.closest(".plex-library-item").classList.toggle("selected", cb.checked);
        confirmBtn.disabled = !list.querySelector("input:checked");
      });
    });

    confirmBtn.disabled = !list.querySelector("input:checked");
  } catch (e) {
    list.innerHTML = `<p class="modal-hint">Failed to load libraries: ${e.message}</p>`;
  }
}

function confirmPlexLibraries() {
  const list = $("plexLibraryList");
  const checked = list.querySelectorAll("input[type=checkbox]:checked");
  state.selectedLibraryKeys = Array.from(checked).map((cb) => cb.value);
  savePlexAuth();
  $("plexLibraryModal").hidden = true;
  loadPlexLibrary();
}

async function loadPlexLibrary() {
  if (!state.plexToken || !state.plexServerUrl) return;
  if (state.selectedLibraryKeys.length === 0) {
    state.library = state.library.filter((b) => b.source !== "plex");
    renderLibrary();
    return;
  }

  try {
    const allLibs = state.plexLibraries.length > 0
      ? state.plexLibraries
      : await PlexAPI.getLibraries(state.plexServerUrl, state.plexToken);

    const selectedLibs = allLibs.filter((l) => state.selectedLibraryKeys.includes(l.key));

    state.library = state.library.filter((b) => b.source !== "plex");

    for (const lib of selectedLibs) {
      const albums = await PlexAPI.getAudiobooks(state.plexServerUrl, lib.key, state.plexToken);
      for (const album of albums) {
        const hasOwnArt = album.thumb && album.thumb !== album.parentThumb;
        state.library.push({
          id: "plex-" + album.ratingKey,
          title: album.title,
          author: album.parentTitle || "",
          source: "plex",
          thumb: hasOwnArt ? PlexAPI.getThumbUrl(state.plexServerUrl, album.thumb, state.plexToken) : "",
          ratingKey: album.ratingKey,
        });
      }
    }
    renderLibrary();
  } catch (e) {
    toast("Failed to load Plex library: " + e.message);
  }
}

function disconnectPlex() {
  state.plexToken = null;
  state.plexServer = null;
  state.plexServerUrl = null;
  state.selectedLibraryKeys = [];
  state.plexLibraries = [];
  savePlexAuth();
  state.library = state.library.filter((b) => b.source !== "plex");
  updatePlexUI();
  renderLibrary();
  toast("Disconnected from Plex");
}

function updatePlexUI() {
  const signInBtn = $("signInBtn");
  const plexStatusBtn = $("plexStatus");
  const connInfo = $("plexConnectionInfo");
  const disconnBtn = $("disconnectPlexBtn");

  const changeLibsBtn = $("changePlexLibsBtn");

  if (state.plexToken && state.plexServer) {
    signInBtn.hidden = true;
    plexStatusBtn.hidden = false;
    plexStatusBtn.textContent = state.plexServer.name;
    const libCount = state.selectedLibraryKeys.length;
    connInfo.textContent = "Connected to " + state.plexServer.name +
      (libCount > 0 ? ` (${libCount} librar${libCount === 1 ? "y" : "ies"} selected)` : "");
    disconnBtn.hidden = false;
    changeLibsBtn.hidden = false;
  } else {
    signInBtn.hidden = false;
    plexStatusBtn.hidden = true;
    connInfo.textContent = "Not connected";
    disconnBtn.hidden = true;
    changeLibsBtn.hidden = true;
  }
}

// Local file handling
function handleLocalFiles(files, isFolderMode) {
  const audioFiles = Array.from(files).filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|m4b|ogg|flac|wav|aac|opus|wma)$/i.test(f.name));

  if (audioFiles.length === 0) {
    toast("No audio files found");
    return;
  }

  if (isFolderMode) {
    const pathParts = audioFiles[0].webkitRelativePath.split("/");
    const folderName = pathParts.length > 1 ? pathParts[0] : "Unknown Book";

    audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const bookId = "local-" + folderName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const tracks = audioFiles.map((f) => ({
      name: f.name.replace(/\.[^.]+$/, ""),
      file: f,
      url: URL.createObjectURL(f),
    }));

    state.library.push({
      id: bookId,
      title: folderName,
      author: "",
      source: "local",
      thumb: "",
      tracks,
    });
  } else {
    audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const f of audioFiles) {
      const bookId = "local-" + f.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
      state.library.push({
        id: bookId,
        title: f.name.replace(/\.[^.]+$/, ""),
        author: "",
        source: "local",
        thumb: "",
        tracks: [{ name: f.name.replace(/\.[^.]+$/, ""), file: f, url: URL.createObjectURL(f) }],
      });
    }
  }

  saveLibrary();
  renderLibrary();
  $("addLocalModal").hidden = true;
  toast(`Added ${audioFiles.length} file(s)`);
}

// Playback
async function openBook(bookId) {
  const book = state.library.find((b) => b.id === bookId);
  if (!book) return;

  state.currentBook = book;

  if (book.source === "plex") {
    try {
      const tracks = await PlexAPI.getAlbumTracks(state.plexServerUrl, book.ratingKey, state.plexToken);
      state.tracks = tracks.map((t) => ({
        name: t.title,
        duration: t.duration / 1000,
        url: PlexAPI.getStreamUrl(state.plexServerUrl, t.Media[0].Part[0].key, state.plexToken),
      }));
    } catch (e) {
      toast("Failed to load tracks: " + e.message);
      return;
    }
  } else {
    state.tracks = book.tracks || [];
  }

  if (state.tracks.length === 0) {
    toast("No tracks found for this book");
    return;
  }

  $("libraryView").hidden = true;
  $("playerView").hidden = false;

  document.querySelector(".footer").hidden = true;

  $("bookTitle").textContent = book.title;
  $("bookAuthor").textContent = book.author || "";

  const art = $("albumArt");
  if (book.thumb) {
    art.src = book.thumb;
    art.style.display = "";
  } else {
    art.src = "";
  }

  populateChapters();

  const pos = state.positions[book.id];
  const trackIdx = pos ? (pos.trackIndex || 0) : 0;
  const time = pos ? (pos.time || 0) : 0;
  loadTrack(trackIdx, time);
}

function populateChapters() {
  const sel = $("chapterSelect");
  sel.innerHTML = "";
  state.tracks.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = t.name || `Track ${i + 1}`;
    sel.appendChild(opt);
  });
}

function loadTrack(index, startTime = 0) {
  if (index < 0 || index >= state.tracks.length) return;

  state.currentTrackIndex = index;
  $("chapterSelect").value = index;

  if (state.audio) {
    state.audio.pause();
    state.audio.removeEventListener("timeupdate", onTimeUpdate);
    state.audio.removeEventListener("ended", onTrackEnded);
    state.audio.removeEventListener("loadedmetadata", onMetadataLoaded);
  }

  state.audio = new Audio(state.tracks[index].url);
  state.audio.playbackRate = state.speed;
  state.audio.addEventListener("timeupdate", onTimeUpdate);
  state.audio.addEventListener("ended", onTrackEnded);
  state.audio.addEventListener("loadedmetadata", onMetadataLoaded);

  if (state.spectrumEnabled) setupSpectrum();

  state.audio.currentTime = startTime;

  if (state.playing) {
    state.audio.play().catch(() => {});
  }

  startPositionSaving();
}

function onMetadataLoaded() {
  $("totalTime").textContent = formatTime(state.audio.duration);
  $("seekBar").max = state.audio.duration || 100;
}

function onTimeUpdate() {
  if (!state.audio) return;
  $("currentTime").textContent = formatTime(state.audio.currentTime);
  $("seekBar").value = state.audio.currentTime;

  const bar = $("seekBar");
  const pct = state.audio.duration ? (state.audio.currentTime / state.audio.duration) * 100 : 0;
  bar.style.background = `linear-gradient(to right, var(--seek-fill) ${pct}%, var(--seek-track) ${pct}%)`;
}

function onTrackEnded() {
  if (state.currentTrackIndex < state.tracks.length - 1) {
    loadTrack(state.currentTrackIndex + 1, 0);
  } else {
    state.playing = false;
    updatePlayButton();
    if (state.currentBook) {
      state.positions[state.currentBook.id] = { trackIndex: 0, time: 0, percent: 1, finished: true };
      savePositions();
    }
    toast("Finished: " + state.currentBook.title);
  }
}

function togglePlay() {
  if (!state.audio) return;
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
  } else {
    state.audio.play().catch(() => {});
    state.playing = true;
  }
  updatePlayButton();
}

function updatePlayButton() {
  $("playPauseBtn").innerHTML = state.playing ? "&#9646;&#9646;" : "&#9654;";
}

function seekRelative(seconds) {
  if (!state.audio) return;
  state.audio.currentTime = Math.max(0, Math.min(state.audio.duration || 0, state.audio.currentTime + seconds));
}

function startPositionSaving() {
  if (state.positionTimer) clearInterval(state.positionTimer);
  state.positionTimer = setInterval(() => {
    if (!state.audio || !state.currentBook) return;
    const totalDuration = state.tracks.reduce((sum, t) => sum + (t.duration || state.audio.duration || 0), 0);
    let elapsed = 0;
    for (let i = 0; i < state.currentTrackIndex; i++) {
      elapsed += state.tracks[i].duration || 0;
    }
    elapsed += state.audio.currentTime;
    const percent = totalDuration > 0 ? elapsed / totalDuration : 0;

    state.positions[state.currentBook.id] = {
      trackIndex: state.currentTrackIndex,
      time: state.audio.currentTime,
      percent,
      finished: false,
    };
    savePositions();
  }, POSITION_SAVE_INTERVAL);
}

function backToLibrary() {
  if (state.audio) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  }
  stopSpectrum();
  $("playerView").hidden = true;
  $("libraryView").hidden = false;

  document.querySelector(".footer").hidden = false;
  renderLibrary();
}

// Audio spectrum analyzer
function setupSpectrum() {
  if (!state.audio) return;
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.sourceNode) {
    try { state.sourceNode.disconnect(); } catch {}
  }
  state.sourceNode = state.audioCtx.createMediaElementSource(state.audio);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.sourceNode.connect(state.analyser);
  state.analyser.connect(state.audioCtx.destination);
  drawSpectrum();
}

function drawSpectrum() {
  if (!state.analyser || !state.spectrumEnabled) return;
  const canvas = $("spectrumCanvas");
  const ctx = canvas.getContext("2d");
  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    if (!state.spectrumEnabled) return;
    state.animFrameId = requestAnimationFrame(draw);
    state.analyser.getByteFrequencyData(dataArray);

    canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = canvas.width / bufferLength;
    let x = 0;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.6 + (dataArray[i] / 255) * 0.4;
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
    ctx.globalAlpha = 1;
  }
  draw();
}

function stopSpectrum() {
  if (state.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }
}

function toggleSpectrum(enabled) {
  state.spectrumEnabled = enabled;
  const art = $("albumArt");
  const canvas = $("spectrumCanvas");
  if (enabled) {
    art.style.display = "none";
    canvas.hidden = false;
    if (state.audio && !state.analyser) setupSpectrum();
    else drawSpectrum();
  } else {
    canvas.hidden = true;
    if (state.currentBook && state.currentBook.thumb) art.style.display = "";
    stopSpectrum();
  }
  localStorage.setItem("plexbook_spectrum", enabled ? "1" : "0");
}

// Theme
function setTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("theme", dark ? "dark" : "light");
}

// Event wiring
function init() {
  loadPositions();
  loadPlexAuth();

  const savedLocal = loadLocalLibrary();
  state.library = savedLocal;

  state.spectrumEnabled = localStorage.getItem("plexbook_spectrum") === "1";
  $("prefSpectrum").checked = state.spectrumEnabled;

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  $("prefTheme").checked = isDark;

  updatePlexUI();
  if (state.plexToken && state.selectedLibraryKeys.length > 0) loadPlexLibrary();
  renderLibrary();

  // Plex auth
  $("signInBtn").addEventListener("click", startPlexAuth);
  $("disconnectPlexBtn").addEventListener("click", disconnectPlex);

  // Plex library picker
  $("plexLibraryConfirm").addEventListener("click", confirmPlexLibraries);
  $("plexLibraryClose").addEventListener("click", () => ($("plexLibraryModal").hidden = true));
  $("changePlexLibsBtn").addEventListener("click", () => {
    $("prefsModal").hidden = true;
    showPlexLibraryPicker();
  });

  // Local files
  $("addLocalBtn").addEventListener("click", () => ($("addLocalModal").hidden = false));
  $("addLocalClose").addEventListener("click", () => ($("addLocalModal").hidden = true));
  $("addFilesBtn").addEventListener("click", () => $("fileInput").click());
  $("addFolderBtn").addEventListener("click", () => $("folderInput").click());
  $("fileInput").addEventListener("change", (e) => handleLocalFiles(e.target.files, false));
  $("folderInput").addEventListener("change", (e) => handleLocalFiles(e.target.files, true));

  // Preferences
  $("prefsBtn").addEventListener("click", () => ($("prefsModal").hidden = false));
  $("prefsClose").addEventListener("click", () => ($("prefsModal").hidden = true));
  $("prefTheme").addEventListener("change", (e) => setTheme(e.target.checked));
  $("prefSpectrum").addEventListener("change", (e) => toggleSpectrum(e.target.checked));

  // Search and filter
  $("searchInput").addEventListener("input", renderLibrary);
  $("sourceFilter").addEventListener("change", renderLibrary);

  // Player controls
  $("backToLibrary").addEventListener("click", backToLibrary);
  $("playPauseBtn").addEventListener("click", togglePlay);
  $("rewindBtn").addEventListener("click", () => seekRelative(-30));
  $("forwardBtn").addEventListener("click", () => seekRelative(30));

  $("speedSelect").addEventListener("change", (e) => {
    state.speed = parseFloat(e.target.value);
    if (state.audio) state.audio.playbackRate = state.speed;
  });

  $("chapterSelect").addEventListener("change", (e) => {
    loadTrack(parseInt(e.target.value), 0);
  });

  $("seekBar").addEventListener("input", (e) => {
    if (state.audio) state.audio.currentTime = parseFloat(e.target.value);
  });

  // Close modals on backdrop click
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (!$("playerView").hidden) {
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "ArrowLeft") seekRelative(-10);
      if (e.code === "ArrowRight") seekRelative(10);
    }
  });

  $("buildStamp").textContent = "PlexBook v1.0.0";
}

init();
