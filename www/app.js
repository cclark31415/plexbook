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
  chapters: [],
  currentChapterIndex: 0,
  audio: null,
  playing: false,
  speed: 1,
  positionTimer: null,
  positions: {},
  downloads: {},
  spectrumEnabled: false,
  analyser: null,
  audioCtx: null,
  sourceNode: null,
  animFrameId: null,
  pinPollTimer: null,
  plexLibraries: [],
  selectedLibraryKeys: [],
};
if (typeof window !== "undefined") {
  window.__plexbook_state = state;
}

function $(id) { return document.getElementById(id); }

let _filesystem = null;
function getFilesystem() {
  if (_filesystem) return _filesystem;
  if (window.Capacitor) {
    if (window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
      _filesystem = window.Capacitor.Plugins.Filesystem;
    } else if (window.Capacitor.registerPlugin) {
      _filesystem = window.Capacitor.registerPlugin("Filesystem");
    }
  }
  return _filesystem;
}
function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function toPlayableSrc(uri) {
  if (window.Capacitor && window.Capacitor.convertFileSrc) return window.Capacitor.convertFileSrc(uri);
  return uri;
}
function safeFilename(s) {
  return (s || "untitled").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}
function extFor(url, container) {
  let ext = container ? container.toLowerCase() : "";
  if (!ext) {
    const m = (url || "").match(/\.([a-z0-9]+)(\?|$)/i);
    ext = m ? m[1].toLowerCase() : "m4b";
  }
  if (ext === "m4b") ext = "m4a";
  return "." + ext;
}

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

function saveDownloads() {
  localStorage.setItem("plexbook_downloads", JSON.stringify(state.downloads));
}

function loadDownloads() {
  try {
    state.downloads = JSON.parse(localStorage.getItem("plexbook_downloads")) || {};
  } catch { state.downloads = {}; }
}

function saveLibrary() {
  const local = state.library.filter((b) => b.source === "local");
  const serializable = local.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    source: b.source,
    trackNames: b.tracks ? b.tracks.map((t) => t.name) : [],
    tracks: b.tracks ? b.tracks.map((t) => ({ name: t.name, chapters: t.chapters || [] })) : [],
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
      tracks: (b.tracks && b.tracks.length > 0)
        ? b.tracks.map((t) => ({ name: t.name, chapters: t.chapters || [], url: null, file: null }))
        : (b.trackNames || []).map((name) => ({ name, chapters: [], url: null, file: null })),
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

function updateNativeMediaSession(action, data) {
  if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
    try {
      const ms = window.Capacitor.Plugins.MediaSession;
      if (action === "load" && data) {
        ms.loadMedia({
          url: data.url,
          title: data.title || "PlexBook",
          artist: data.artist || "",
          artworkUrl: data.artworkUrl || "",
          position: Math.round((data.position || 0) * 1000)
        });
      } else if (action === "play") {
        ms.play();
      } else if (action === "pause") {
        ms.pause();
      } else if (action === "seek" && data) {
        ms.seek({ position: Math.round(data.position) });
      } else if (action === "seekBack") {
        ms.seekBack();
      } else if (action === "seekForward") {
        ms.seekForward();
      }
    } catch (e) {
      console.warn("MediaSession plugin call failed:", e);
    }
  }
}

function restoreLastPlayedBook() {
  const lastBookId = localStorage.getItem("plexbook_last_played_book_id");
  if (!lastBookId || state.currentBook) return;

  let book = state.library.find((b) => b.id === lastBookId);
  if (!book) {
    try {
      const savedData = JSON.parse(localStorage.getItem("plexbook_last_played_book_data"));
      if (savedData && savedData.id === lastBookId) {
        book = savedData;
        state.library.push(book);
      }
    } catch (e) {}
  }

  if (book) {
    openBook(lastBookId);
  }
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

    const isDownloaded = !!(state.downloads[book.id] && state.downloads[book.id].uris && state.downloads[book.id].uris.length);
    const sourceBadgeHtml = isDownloaded
      ? `<span class="book-card-source downloaded">&#10003; Downloaded</span>`
      : `<span class="book-card-source">${book.source}</span>`;

    return `<div class="book-card" data-book-id="${book.id}">
      <div class="book-card-art">${artHtml}</div>
      <div class="book-card-info">
        <p class="book-card-title" title="${book.title}">${book.title}</p>
        <p class="book-card-author">${book.author || "Unknown"}</p>
        ${sourceBadgeHtml}
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
async function handleLocalFiles(files, isFolderMode) {
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
    const tracks = await Promise.all(audioFiles.map(async (f) => {
      let chapters = [];
      if (/\.(m4b|m4a|mp4)$/i.test(f.name)) {
        try {
          const parsed = await ChapterParser.parseChapters(f);
          if (parsed && parsed.length > 0) {
            chapters = parsed.map((c) => ({ name: c.title, startOffset: c.startTime }));
          }
        } catch (e) {
          console.warn("Local chapter pre-parse failed:", e);
        }
      }
      return {
        name: f.name.replace(/\.[^.]+$/, ""),
        file: f,
        url: URL.createObjectURL(f),
        chapters,
      };
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
      let chapters = [];
      if (/\.(m4b|m4a|mp4)$/i.test(f.name)) {
        try {
          const parsed = await ChapterParser.parseChapters(f);
          if (parsed && parsed.length > 0) {
            chapters = parsed.map((c) => ({ name: c.title, startOffset: c.startTime }));
          }
        } catch (e) {
          console.warn("Local chapter pre-parse failed:", e);
        }
      }
      state.library.push({
        id: bookId,
        title: f.name.replace(/\.[^.]+$/, ""),
        author: "",
        source: "local",
        thumb: "",
        tracks: [{ name: f.name.replace(/\.[^.]+$/, ""), file: f, url: URL.createObjectURL(f), chapters }],
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

  localStorage.setItem("plexbook_last_played_book_id", bookId);
  try {
    localStorage.setItem("plexbook_last_played_book_data", JSON.stringify({
      id: book.id,
      title: book.title,
      author: book.author,
      source: book.source,
      thumb: book.thumb,
      ratingKey: book.ratingKey,
      tracks: book.tracks ? book.tracks.map((t) => ({ name: t.name, duration: t.duration, url: t.url, container: t.container, chapters: t.chapters || [] })) : []
    }));
  } catch (e) {}

  if (book.source === "plex") {
    try {
      const tracks = await PlexAPI.getAlbumTracks(state.plexServerUrl, book.ratingKey, state.plexToken);
      state.tracks = tracks.map((t) => {
        const part = (t.Media && t.Media[0] && t.Media[0].Part && t.Media[0].Part[0]) || {};
        const plexChapters = (t.Chapter || []).map((c) => ({
          name: c.tag || c.name || `Chapter ${c.index || ""}`,
          startOffset: (c.startTimeOffset || 0) / 1000,
          endOffset: c.endTimeOffset ? c.endTimeOffset / 1000 : undefined,
        }));
        return {
          name: t.title,
          duration: t.duration / 1000,
          url: PlexAPI.getStreamUrl(state.plexServerUrl, part.key, state.plexToken),
          container: part.container || null,
          chapters: plexChapters,
        };
      });
    } catch (e) {
      toast("Failed to load tracks: " + e.message);
      return;
    }
  } else {
    state.tracks = (book.tracks || []).map((t) => ({ ...t, chapters: t.chapters || [] }));
  }

  if (state.tracks.length === 0) {
    toast("No tracks found for this book");
    return;
  }

  const dl = state.downloads[book.id];
  if (dl && dl.uris && dl.uris.length === state.tracks.length) {
    state.tracks.forEach((t, i) => { t.url = toPlayableSrc(dl.uris[i]); t.localUri = dl.uris[i]; });
    if (dl.chapters && dl.chapters.length > 0) {
      state.tracks[0].chapters = dl.chapters;
    }
  }

  // Parse chapters from file or stream URL if not already present
  if (state.tracks[0] && (!state.tracks[0].chapters || state.tracks[0].chapters.length === 0)) {
    const chapterSource = state.tracks[0].file || state.tracks[0].url;
    if (chapterSource) {
      try {
        const parsed = await ChapterParser.parseChapters(chapterSource);
        if (parsed && parsed.length > 0) {
          state.tracks[0].chapters = parsed.map((c) => ({ name: c.title, startOffset: c.startTime }));
          if (book.tracks && book.tracks[0]) {
            book.tracks[0].chapters = state.tracks[0].chapters;
          }
          if (book.source === "local") {
            saveLibrary();
          }
        }
      } catch (e) {
        console.warn("Chapter parse failed:", e);
      }
    }
  }

  $("libraryView").hidden = true;
  $("playerView").hidden = false;

  document.querySelector(".footer").hidden = true;

  $("bookTitle").textContent = book.title;
  $("bookAuthor").textContent = book.author || "";

  const badge = $("playerSourceBadge");
  if (badge) {
    const isDownloaded = !!(state.downloads[book.id] && state.downloads[book.id].uris && state.downloads[book.id].uris.length);
    badge.hidden = false;
    if (isDownloaded) {
      badge.className = "player-source-badge downloaded";
      badge.innerHTML = "&#10003; Downloaded &bull; Playing Locally";
    } else if (book.source === "plex") {
      badge.className = "player-source-badge streaming";
      badge.textContent = "Streaming from Plex";
    } else {
      badge.className = "player-source-badge local";
      badge.textContent = "Local file";
    }
  }

  const art = $("albumArt");
  const canvas = $("spectrumCanvas");
  if (state.spectrumEnabled) {
    if (art) art.style.display = "none";
    if (canvas) canvas.hidden = false;
    setupSpectrum();
  } else {
    if (canvas) canvas.hidden = true;
    if (art) {
      if (book.thumb) {
        art.src = book.thumb;
        art.style.display = "";
      } else {
        art.src = "";
        art.style.display = "none";
      }
    }
    stopSpectrum();
  }

  buildChapters();
  populateChapters();

  const downloadBtn = $("downloadBookBtn");
  if (downloadBtn) {
    const alreadyDownloaded = !!(state.downloads[book.id] && state.downloads[book.id].uris);
    downloadBtn.hidden = !(book.source === "plex" && isNative()) || alreadyDownloaded;
  }

  const pos = state.positions[book.id];
  const trackIdx = pos ? (pos.trackIndex || 0) : 0;
  const time = pos ? (pos.time || 0) : 0;
  loadTrack(trackIdx, time);
}

async function downloadCurrentBook() {
  const book = state.currentBook;
  if (!book || book.source !== "plex") {
    toast("Can only download Plex audiobooks.");
    return;
  }
  if (!isNative()) {
    toast("Downloads are only available in the mobile app.");
    return;
  }
  const Filesystem = getFilesystem();
  if (!Filesystem) {
    toast("Filesystem plugin not available.");
    return;
  }

  const btn = $("downloadBookBtn");
  if (btn) btn.disabled = true;

  const folder = "audiobooks/" + safeFilename(book.title);
  try {
    await Filesystem.mkdir({
      path: folder,
      directory: "DATA",
      recursive: true,
    });
  } catch (err) {
    console.log("Folder already exists or mkdir info:", err);
  }

  const uris = [];
  let progressListener;
  try {
    progressListener = await Filesystem.addListener("progress", (event) => {
      if (event && event.contentLength) {
        const pct = Math.round((event.bytes / event.contentLength) * 100);
        if (btn) btn.textContent = `Downloading… ${pct}%`;
      }
    });

    for (let i = 0; i < state.tracks.length; i++) {
      const track = state.tracks[i];
      const ext = extFor(track.url, track.container);
      const filename = state.tracks.length === 1
        ? safeFilename(book.title) + ext
        : String(i + 1).padStart(3, "0") + " - " + safeFilename(track.name) + ext;
      const path = folder + "/" + filename;
      if (btn) btn.textContent = `Downloading ${i + 1}/${state.tracks.length}…`;
      const result = await Filesystem.downloadFile({
        url: track.url,
        path,
        directory: "DATA",
        recursive: true,
        progress: true,
      });
      uris.push(result.path);
    }
  } catch (e) {
    console.error("Download failed:", e);
    toast("Download failed: " + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = "⬇ Download"; }
    if (progressListener) progressListener.remove();
    return;
  }
  if (progressListener) progressListener.remove();

  let parsedChapters = (state.tracks[0] && state.tracks[0].chapters && state.tracks[0].chapters.length > 0)
    ? state.tracks[0].chapters
    : [];

  if (parsedChapters.length === 0) {
    try {
      if (btn) btn.textContent = "Parsing chapters…";
      const resp = await fetch(toPlayableSrc(uris[0]));
      const blob = await resp.blob();
      const parsed = await ChapterParser.parseChapters(blob);
      parsedChapters = parsed.map((c) => ({ name: c.title, startOffset: c.startTime }));
    } catch (e) {
      console.warn("Chapter parse failed:", e);
    }
  }

  state.downloads[book.id] = { uris, chapters: parsedChapters };
  saveDownloads();

  state.tracks.forEach((t, i) => { t.url = toPlayableSrc(uris[i]); t.localUri = uris[i]; });
  if (parsedChapters.length > 0) state.tracks[0].chapters = parsedChapters;
  buildChapters();
  populateChapters();

  const curTime = state.audio ? state.audio.currentTime : 0;
  const wasPlaying = state.playing;
  loadTrack(state.currentTrackIndex, curTime);
  if (wasPlaying) {
    state.playing = true;
    if (state.audio) state.audio.play().catch(() => {});
    updatePlayButton();
  }

  if (btn) { btn.hidden = true; btn.disabled = false; btn.textContent = "⬇ Download"; }
  const badge = $("playerSourceBadge");
  if (badge) {
    badge.hidden = false;
    badge.className = "player-source-badge downloaded";
    badge.innerHTML = "&#10003; Downloaded &bull; Playing Locally";
  }
  toast(`Downloaded "${book.title}"` + (parsedChapters.length > 0 ? ` (${parsedChapters.length} chapters)` : ""));
}

function buildChapters() {
  state.chapters = [];
  state.tracks.forEach((t, ti) => {
    if (t.chapters && t.chapters.length > 0) {
      t.chapters.forEach((c) => {
        state.chapters.push({
          name: c.name || `Chapter ${state.chapters.length + 1}`,
          trackIndex: ti,
          startOffset: c.startOffset || 0,
        });
      });
    } else {
      state.chapters.push({
        name: t.name || `Track ${ti + 1}`,
        trackIndex: ti,
        startOffset: 0,
      });
    }
  });
}

function populateChapters() {
  const sel = $("chapterSelect");
  sel.innerHTML = "";
  state.chapters.forEach((c, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

function chapterIndexFor(trackIndex, time) {
  let last = 0;
  for (let i = 0; i < state.chapters.length; i++) {
    const c = state.chapters[i];
    if (c.trackIndex < trackIndex) { last = i; continue; }
    if (c.trackIndex > trackIndex) break;
    if (c.startOffset <= time) last = i;
    else break;
  }
  return last;
}

function getCurrentTime() {
  if (isNative()) {
    return state.nativePosition || 0;
  }
  return state.audio ? state.audio.currentTime || 0 : 0;
}

function getDuration() {
  if (isNative()) {
    return state.nativeDuration || 0;
  }
  return state.audio ? state.audio.duration || 0 : 0;
}

function updateChapterSelection() {
  const curTime = getCurrentTime();
  const idx = chapterIndexFor(state.currentTrackIndex, curTime);
  if (idx !== state.currentChapterIndex) {
    state.currentChapterIndex = idx;
    $("chapterSelect").value = idx;
  }
}

const PLAY_ICON_SVG = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON_SVG = '<svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function updatePlayButton() {
  $("playPauseBtn").innerHTML = state.playing ? PAUSE_ICON_SVG : PLAY_ICON_SVG;
}

function onAudioError() {
  const err = (state.audio && state.audio.error) || null;
  let msg = "Audio playback failed";
  if (err) {
    switch (err.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        msg = "Playback aborted";
        break;
      case MediaError.MEDIA_ERR_NETWORK:
        msg = "Network error loading audio stream";
        break;
      case MediaError.MEDIA_ERR_DECODE:
        msg = "Audio decoding error";
        break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        msg = "Audio format not supported or URL unreachable";
        break;
      default:
        msg = "Audio error (" + err.code + "): " + (err.message || "unknown");
    }
  }
  console.error("Audio error:", msg, err, state.audio ? state.audio.src : "");
  toast(msg);
  state.playing = false;
  updatePlayButton();
}

function loadTrack(index, startTime = 0) {
  if (index < 0 || index >= state.tracks.length) return;

  state.currentTrackIndex = index;
  state.currentChapterIndex = chapterIndexFor(index, startTime);
  $("chapterSelect").value = state.currentChapterIndex;

  const trackUrl = state.tracks[index].url;
  console.log("Loading track:", index, trackUrl);

  if (isNative()) {
    if (state.audio) {
      try { state.audio.pause(); } catch (e) {}
      state.audio = null;
    }
    state.nativePosition = startTime;
    $("currentTime").textContent = formatTime(startTime);
    $("seekBar").value = startTime;

    updateNativeMediaSession("load", {
      url: trackUrl,
      title: state.currentBook ? state.currentBook.title : "PlexBook",
      artist: state.currentBook ? state.currentBook.author : "",
      artworkUrl: state.currentBook ? state.currentBook.thumb : "",
      position: startTime || 0
    });

    if (state.playing) {
      updateNativeMediaSession("play");
    }
    startPositionSaving();
    return;
  }

  // Web Browser fallback
  if (state.audio) {
    state.audio.pause();
    state.audio.removeEventListener("timeupdate", onTimeUpdate);
    state.audio.removeEventListener("ended", onTrackEnded);
    state.audio.removeEventListener("loadedmetadata", onMetadataLoaded);
    state.audio.removeEventListener("error", onAudioError);
  }

  state.audio = new Audio();
  state.audio.crossOrigin = "anonymous";
  state.audio.src = trackUrl;
  state.audio.playbackRate = state.speed;

  let seekApplied = false;
  const applySeek = () => {
    if (!seekApplied && startTime > 0 && state.audio) {
      try {
        if (state.audio.duration && !isNaN(state.audio.duration)) {
          state.audio.currentTime = Math.min(startTime, state.audio.duration);
          seekApplied = true;
        } else if (state.audio.seekable && state.audio.seekable.length > 0) {
          state.audio.currentTime = startTime;
          seekApplied = true;
        }
      } catch (e) {
        console.warn("Seek to startTime failed:", e);
      }
    }
  };

  state.audio.addEventListener("timeupdate", onTimeUpdate);
  state.audio.addEventListener("ended", onTrackEnded);
  state.audio.addEventListener("loadedmetadata", () => {
    onMetadataLoaded();
    applySeek();
  });
  state.audio.addEventListener("canplay", applySeek);
  state.audio.addEventListener("error", onAudioError);

  if (state.spectrumEnabled) {
    try { setupSpectrum(); } catch (e) { console.warn("Spectrum setup failed:", e); }
  }

  if (state.playing) {
    const p = state.audio.play();
    if (p !== undefined) {
      p.catch((err) => {
        console.error("Playback failed:", err);
        state.playing = false;
        updatePlayButton();
        toast("Playback failed: " + (err.message || "Check network/server"));
      });
    }
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

  updateChapterSelection();
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
  if (isNative()) {
    if (state.playing) {
      updateNativeMediaSession("pause");
    } else {
      updateNativeMediaSession("play");
    }
    return;
  }

  if (!state.audio) return;
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
    updatePlayButton();
  } else {
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
    const playPromise = state.audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          state.playing = true;
          updatePlayButton();
        })
        .catch((err) => {
          console.error("Play failed:", err);
          state.playing = false;
          updatePlayButton();
          toast("Playback failed: " + (err.message || "Cannot play audio"));
        });
    } else {
      state.playing = true;
      updatePlayButton();
    }
  }
}

function seekRelative(seconds) {
  if (isNative()) {
    if (seconds === -30) {
      updateNativeMediaSession("seekBack");
    } else if (seconds === 30) {
      updateNativeMediaSession("seekForward");
    } else {
      const curMs = (state.nativePosition || 0) * 1000;
      updateNativeMediaSession("seek", { position: Math.max(0, curMs + seconds * 1000) });
    }
    return;
  }

  if (!state.audio) return;
  state.audio.currentTime = Math.max(0, Math.min(state.audio.duration || 0, state.audio.currentTime + seconds));
}

function startPositionSaving() {
  if (state.positionTimer) clearInterval(state.positionTimer);
  state.positionTimer = setInterval(() => {
    if (!state.currentBook) return;
    const curTime = getCurrentTime();
    const dur = getDuration();
    const totalDuration = state.tracks.reduce((sum, t) => sum + (t.duration || dur || 0), 0);
    let elapsed = 0;
    for (let i = 0; i < state.currentTrackIndex; i++) {
      elapsed += state.tracks[i].duration || 0;
    }
    elapsed += curTime;
    const percent = totalDuration > 0 ? elapsed / totalDuration : 0;

    state.positions[state.currentBook.id] = {
      trackIndex: state.currentTrackIndex,
      time: curTime,
      percent,
      finished: false,
    };
    savePositions();
  }, POSITION_SAVE_INTERVAL);
}

function backToLibrary() {
  if (isNative()) {
    updateNativeMediaSession("pause");
  } else if (state.audio) {
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
  if (!state.spectrumEnabled) return;
  try {
    if (state.audio) {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      if (state.sourceNode) {
        try { state.sourceNode.disconnect(); } catch {}
      }
      state.sourceNode = state.audioCtx.createMediaElementSource(state.audio);
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 256;
      state.sourceNode.connect(state.analyser);
      state.analyser.connect(state.audioCtx.destination);
    }
  } catch (err) {
    console.warn("Could not setup audio spectrum:", err);
  }
  drawSpectrum();
}

function drawSpectrum() {
  if (!state.spectrumEnabled) return;
  const canvas = $("spectrumCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function draw() {
    if (!state.spectrumEnabled) return;
    state.animFrameId = requestAnimationFrame(draw);

    const dpr = window.devicePixelRatio || 1;
    const clientW = canvas.clientWidth || canvas.offsetWidth || 320;
    const clientH = canvas.clientHeight || canvas.offsetHeight || 320;

    canvas.width = clientW * dpr;
    canvas.height = clientH * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e5a00d";

    if (isNative()) {
      if (state.playing && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
        window.Capacitor.Plugins.MediaSession.getFrequencyData().then((res) => {
          if (res && res.frequencies && res.frequencies.length > 0) {
            state.nativeFrequencies = res.frequencies;
          }
        }).catch(() => {});
      }

      const bufferLength = 32;
      const barWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        let barHeight = 0;
        if (state.playing) {
          const pcmAmp = (state.nativeFrequencies && state.nativeFrequencies[i] !== undefined)
            ? state.nativeFrequencies[i]
            : 0;
          barHeight = Math.max(6 * dpr, pcmAmp * canvas.height * 0.9);
        } else {
          barHeight = 4 * dpr;
        }
        ctx.fillStyle = accent;
        ctx.globalAlpha = state.playing ? 0.55 + (barHeight / canvas.height) * 0.45 : 0.25;
        ctx.fillRect(x, canvas.height - barHeight, Math.max(1, barWidth - 2 * dpr), barHeight);
        x += barWidth;
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (state.analyser) {
      const bufferLength = state.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      state.analyser.getByteFrequencyData(dataArray);

      const barWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.6 + (dataArray[i] / 255) * 0.4;
        ctx.fillRect(x, canvas.height - barHeight, Math.max(1, barWidth - 1), barHeight);
        x += barWidth;
      }
      ctx.globalAlpha = 1;
      return;
    }

    // Stationary Multi-Band Frequency Spectrum Visualizer (Stationary vertical pulsing, ZERO horizontal scrolling)
    const bufferLength = 32;
    const barWidth = canvas.width / bufferLength;
    let x = 0;
    const now = Date.now() / 1000;

    for (let i = 0; i < bufferLength; i++) {
      let barHeight = 0;
      if (state.playing) {
        const freqRatio = i / bufferLength;
        const envelope = Math.sin(Math.PI * (freqRatio * 0.85 + 0.1));

        // Independent stationary oscillation rates per bar (no spatial phase gradient)
        const rate1 = 2.5 + ((i * 7) % 11) * 0.7;
        const rate2 = 4.2 + ((i * 13) % 7) * 1.1;
        const staticPhase = (i * 2.39) % 3.14159;

        const pulse = Math.abs(Math.sin(now * rate1 + staticPhase) * 0.6 + Math.cos(now * rate2 + staticPhase * 0.5) * 0.4);
        const val = Math.max(0.08, pulse * envelope * 0.95);
        barHeight = val * canvas.height;
      } else {
        barHeight = 4 * dpr;
      }
      ctx.fillStyle = accent;
      ctx.globalAlpha = state.playing ? 0.55 + (barHeight / canvas.height) * 0.45 : 0.25;
      ctx.fillRect(x, canvas.height - barHeight, Math.max(1, barWidth - 2 * dpr), barHeight);
      x += barWidth;
    }
    ctx.globalAlpha = 1;
  }

  stopSpectrum();
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
    if (art) art.style.display = "none";
    if (canvas) canvas.hidden = false;
    setupSpectrum();
  } else {
    if (canvas) canvas.hidden = true;
    if (art) {
      if (state.currentBook && state.currentBook.thumb) {
        art.src = state.currentBook.thumb;
        art.style.display = "";
      } else {
        art.src = "";
        art.style.display = "none";
      }
    }
    stopSpectrum();
  }
  localStorage.setItem("plexbook_spectrum", enabled ? "1" : "0");
  const prefBox = $("prefSpectrum");
  if (prefBox) prefBox.checked = enabled;
}

// Theme
function setTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("theme", dark ? "dark" : "light");

  if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
    window.Capacitor.Plugins.MediaSession.setStatusBarStyle({ isDark: dark });
  }
}

// Event wiring
function init() {
  loadPositions();
  loadDownloads();
  loadPlexAuth();

  const savedLocal = loadLocalLibrary();
  state.library = savedLocal;

  state.spectrumEnabled = localStorage.getItem("plexbook_spectrum") === "1";
  $("prefSpectrum").checked = state.spectrumEnabled;

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  $("prefTheme").checked = isDark;

  updatePlexUI();
  restoreLastPlayedBook();
  if (state.plexToken && state.selectedLibraryKeys.length > 0) {
    loadPlexLibrary().then(() => {
      restoreLastPlayedBook();
    });
  }
  renderLibrary();

  if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
    try {
      const ms = window.Capacitor.Plugins.MediaSession;
      ms.addListener("onPlaybackStateChanged", (data) => {
        if (data && data.isPlaying !== undefined) {
          state.playing = data.isPlaying;
          updatePlayButton();
        }
      });
      ms.addListener("onPositionChanged", (data) => {
        if (data && data.position !== undefined) {
          const sec = data.position / 1000;
          if (sec === 0 && state.nativePosition > 0 && !state.playing) {
            return;
          }
          state.nativePosition = sec;
          $("currentTime").textContent = formatTime(sec);
          $("seekBar").value = sec;
          const totalDur = getDuration();
          if (totalDur > 0) {
            const pct = Math.min(100, (sec / totalDur) * 100);
            $("seekBar").style.background = `linear-gradient(to right, var(--seek-fill) ${pct}%, var(--seek-track) ${pct}%)`;
          }
          updateChapterSelection();
        }
      });
      ms.addListener("onDurationChanged", (data) => {
        if (data && data.duration !== undefined && data.duration > 0) {
          const durSec = data.duration / 1000;
          state.nativeDuration = durSec;
          $("totalTime").textContent = formatTime(durSec);
          $("seekBar").max = durSec;
        }
      });
    } catch (e) {
      console.warn("MediaSession listener failed:", e);
    }
  }

  setInterval(() => {
    if (isNative() && state.playing) {
      state.nativePosition = (state.nativePosition || 0) + 1;
      const sec = state.nativePosition;
      const totalDur = getDuration();
      $("currentTime").textContent = formatTime(sec);
      $("seekBar").value = sec;
      if (totalDur > 0) {
        const pct = Math.min(100, (sec / totalDur) * 100);
        $("seekBar").style.background = `linear-gradient(to right, var(--seek-fill) ${pct}%, var(--seek-track) ${pct}%)`;
      }
      updateChapterSelection();
    }
  }, 1000);

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
  const artWrap = $("playerArtWrap");
  if (artWrap) {
    artWrap.addEventListener("click", () => {
      toggleSpectrum(!state.spectrumEnabled);
    });
    artWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSpectrum(!state.spectrumEnabled);
      }
    });
  }
  $("backToLibrary").addEventListener("click", backToLibrary);
  $("playPauseBtn").addEventListener("click", togglePlay);
  $("rewindBtn").addEventListener("click", () => seekRelative(-30));
  $("forwardBtn").addEventListener("click", () => seekRelative(30));

  $("speedSelect").addEventListener("change", (e) => {
    state.speed = parseFloat(e.target.value);
    if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
      window.Capacitor.Plugins.MediaSession.setSpeed({ speed: state.speed });
    } else if (state.audio) {
      state.audio.playbackRate = state.speed;
    }
  });

  $("chapterSelect").addEventListener("change", (e) => {
    const idx = parseInt(e.target.value);
    const ch = state.chapters[idx];
    if (!ch) return;
    state.currentChapterIndex = idx;
    const seekTime = ch.startOffset || 0;
    state.nativePosition = seekTime;
    $("currentTime").textContent = formatTime(seekTime);
    $("seekBar").value = seekTime;

    if (ch.trackIndex === state.currentTrackIndex) {
      if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
        window.Capacitor.Plugins.MediaSession.seek({ position: Math.round(seekTime * 1000) });
      } else if (state.audio) {
        state.audio.currentTime = seekTime;
      }
    } else {
      loadTrack(ch.trackIndex, seekTime);
    }
  });

  const dlBtn = $("downloadBookBtn");
  if (dlBtn) dlBtn.addEventListener("click", downloadCurrentBook);

  $("seekBar").addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession) {
      state.nativePosition = val;
      $("currentTime").textContent = formatTime(val);
      window.Capacitor.Plugins.MediaSession.seek({ position: Math.round(val * 1000) });
    } else if (state.audio) {
      state.audio.currentTime = val;
    }
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
