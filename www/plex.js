(function () {
  "use strict";

  const CLIENT_ID = "plexbook-" + (localStorage.getItem("plexClientId") || crypto.randomUUID());
  localStorage.setItem("plexClientId", CLIENT_ID);

  const PLEX_HEADERS = {
    Accept: "application/json",
    "X-Plex-Product": "PlexBook",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Client-Identifier": CLIENT_ID,
    "X-Plex-Platform": "Web",
  };

  function headers(token) {
    const h = { ...PLEX_HEADERS };
    if (token) h["X-Plex-Token"] = token;
    return h;
  }

  async function getPin() {
    const resp = await fetch("https://plex.tv/api/v2/pins?strong=true", {
      method: "POST",
      headers: headers(),
    });
    if (!resp.ok) throw new Error("Failed to create Plex PIN");
    return resp.json();
  }

  function getAuthUrl(pinId, code) {
    const params = new URLSearchParams({
      clientID: CLIENT_ID,
      code: code,
      "context[device][product]": "PlexBook",
      "context[device][version]": "1.0.0",
      "context[device][platform]": "Web",
    });
    return `https://app.plex.tv/auth#?${params}`;
  }

  async function checkPin(pinId) {
    const resp = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: headers(),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.authToken || null;
  }

  async function getServers(token) {
    const resp = await fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", {
      headers: headers(token),
    });
    if (!resp.ok) throw new Error("Failed to fetch servers");
    const resources = await resp.json();
    return resources.filter((r) => r.provides === "server");
  }

  async function getLibraries(serverUrl, token) {
    const resp = await fetch(`${serverUrl}/library/sections`, {
      headers: headers(token),
    });
    if (!resp.ok) throw new Error("Failed to fetch libraries");
    const data = await resp.json();
    return data.MediaContainer.Directory || [];
  }

  async function getAudiobooks(serverUrl, sectionKey, token) {
    const resp = await fetch(`${serverUrl}/library/sections/${sectionKey}/all?type=9`, {
      headers: headers(token),
    });
    if (!resp.ok) throw new Error("Failed to fetch audiobooks");
    const data = await resp.json();
    return data.MediaContainer.Metadata || [];
  }

  async function getAlbumTracks(serverUrl, ratingKey, token) {
    const resp = await fetch(`${serverUrl}/library/metadata/${ratingKey}/children?includeChapters=1`, {
      headers: headers(token),
    });
    if (!resp.ok) throw new Error("Failed to fetch tracks");
    const data = await resp.json();
    const tracks = data.MediaContainer.Metadata || [];
    await Promise.all(tracks.map(async (t) => {
      if (!t.Chapter || t.Chapter.length === 0) {
        try {
          const chapters = await getTrackChapters(serverUrl, t.ratingKey, token);
          if (chapters.length > 0) t.Chapter = chapters;
        } catch {}
      }
    }));
    return tracks;
  }

  async function getTrackChapters(serverUrl, ratingKey, token) {
    const resp = await fetch(`${serverUrl}/library/metadata/${ratingKey}?includeChapters=1`, {
      headers: headers(token),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const md = (data.MediaContainer.Metadata || [])[0];
    return (md && md.Chapter) || [];
  }

  function getStreamUrl(serverUrl, partKey, token) {
    return `${serverUrl}${partKey}?X-Plex-Token=${token}`;
  }

  function getThumbUrl(serverUrl, thumbPath, token) {
    if (!thumbPath) return "";
    return `${serverUrl}${thumbPath}?X-Plex-Token=${token}`;
  }

  async function getMusicLibraries(serverUrl, token) {
    const libs = await getLibraries(serverUrl, token);
    return libs.filter((l) => l.type === "artist");
  }

  window.PlexAPI = {
    getPin,
    getAuthUrl,
    checkPin,
    getServers,
    getLibraries,
    getMusicLibraries,
    getAudiobooks,
    getAlbumTracks,
    getStreamUrl,
    getThumbUrl,
    headers,
  };
})();
