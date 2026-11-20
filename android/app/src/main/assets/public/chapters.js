(function () {
  "use strict";

  async function parseChapters(source) {
    if (!source) return [];
    try {
      const reader = makeReader(source);
      const fileSize = await reader.size();
      if (!fileSize || fileSize < 8) return [];

      const moovLoc = await findTopLevelAtom(reader, fileSize, "moov");
      if (!moovLoc) return [];

      const moovBuf = await reader.read(moovLoc.dataOffset, moovLoc.dataSize);
      const moovView = new DataView(moovBuf);

      const chpl = findChplChapters(moovView, 0, moovBuf.byteLength);
      if (chpl.length > 0) return chpl;

      return await findQuickTimeChapters(reader, moovView, moovBuf);
    } catch (e) {
      console.warn("ChapterParser: parseChapters failed", e);
      return [];
    }
  }

  function makeReader(source) {
    if ((typeof Blob !== "undefined" && source instanceof Blob) ||
        (typeof File !== "undefined" && source instanceof File) ||
        (source && typeof source.slice === "function" && typeof source.size === "number")) {
      return {
        size: () => Promise.resolve(source.size),
        read: (offset, length) => source.slice(offset, offset + length).arrayBuffer(),
      };
    }
    if (typeof source === "string") {
      let totalSize = null;
      return {
        size: async () => {
          if (totalSize !== null) return totalSize;
          try {
            const resp = await fetch(source, { method: "HEAD" });
            const cl = resp.headers.get("content-length");
            if (cl) totalSize = parseInt(cl, 10);
          } catch {}
          if (!totalSize) {
            // Fallback: request first byte to read content-range
            try {
              const resp = await fetch(source, { headers: { Range: "bytes=0-0" } });
              const cr = resp.headers.get("content-range");
              if (cr) {
                const m = cr.match(/\/(\d+)$/);
                if (m) totalSize = parseInt(m[1], 10);
              }
            } catch {}
          }
          return totalSize || 0;
        },
        read: async (offset, length) => {
          const resp = await fetch(source, {
            headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          });
          return resp.arrayBuffer();
        },
      };
    }
    throw new Error("Unsupported source type for ChapterParser");
  }

  async function findTopLevelAtom(reader, fileSize, targetType) {
    let pos = 0;
    while (pos + 8 <= fileSize) {
      const chunk = await reader.read(pos, 16);
      if (chunk.byteLength < 8) break;
      const hView = new DataView(chunk);
      let size = hView.getUint32(0);
      const type = String.fromCharCode(
        hView.getUint8(4), hView.getUint8(5), hView.getUint8(6), hView.getUint8(7)
      );
      let headerSize = 8;
      if (size === 1) {
        if (chunk.byteLength < 16) break;
        const hi = hView.getUint32(8);
        const lo = hView.getUint32(12);
        size = hi * 0x100000000 + lo;
        headerSize = 16;
      }
      if (size < 8) break;
      if (type === targetType) {
        return { offset: pos, dataOffset: pos + headerSize, dataSize: size - headerSize };
      }
      pos += size;
    }
    return null;
  }

  function readUTF8(view, offset, length) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function getAtomType(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
  }

  function getAtomSize(view, offset) {
    const size = view.getUint32(offset);
    if (size === 1 && offset + 16 <= view.byteLength) {
      const hi = view.getUint32(offset + 8);
      const lo = view.getUint32(offset + 12);
      return hi * 0x100000000 + lo;
    }
    return size;
  }

  function findAtom(view, start, end, type) {
    let pos = start;
    while (pos + 8 <= end) {
      const size = getAtomSize(view, pos);
      if (size < 8) break;
      const t = getAtomType(view, pos + 4);
      if (t === type) return { offset: pos + 8, size: size - 8 };
      pos += size;
    }
    return null;
  }

  function findAtomPath(view, start, end, path) {
    let cur = { offset: start, size: end - start };
    for (const type of path) {
      const found = findAtom(view, cur.offset, cur.offset + cur.size, type);
      if (!found) return null;
      cur = found;
    }
    return cur;
  }

  function findAllAtoms(view, start, end, type) {
    const results = [];
    let pos = start;
    while (pos + 8 <= end) {
      const size = getAtomSize(view, pos);
      if (size < 8) break;
      const t = getAtomType(view, pos + 4);
      if (t === type) results.push({ offset: pos + 8, size: size - 8 });
      pos += size;
    }
    return results;
  }

  // Nero chapter format: moov > udta > chpl
  function findChplChapters(view, moovStart, moovSize) {
    const chpl = findAtomPath(view, moovStart, moovStart + moovSize, ["udta", "chpl"]);
    if (!chpl) return [];

    const chapters = [];
    let pos = chpl.offset;
    const end = chpl.offset + chpl.size;

    if (pos + 8 > end) return [];
    pos += 4; // version + flags
    pos += 4; // reserved

    if (pos + 1 > end) return [];
    const count = view.getUint8(pos);
    pos += 1;

    for (let i = 0; i < count && pos + 9 <= end; i++) {
      const tsHi = view.getUint32(pos);
      const tsLo = view.getUint32(pos + 4);
      const timestamp100ns = tsHi * 0x100000000 + tsLo;
      const startSec = timestamp100ns / 10000000;
      pos += 8;

      if (pos + 1 > end) break;
      const titleLen = view.getUint8(pos);
      pos += 1;

      if (pos + titleLen > end) break;
      const title = readUTF8(view, pos, titleLen);
      pos += titleLen;

      chapters.push({ title, startTime: startSec });
    }

    return chapters;
  }

  // QuickTime chapter track format
  async function findQuickTimeChapters(reader, moovView, moovBuf) {
    const traks = findAllAtoms(moovView, 0, moovBuf.byteLength, "trak");

    let chapterTrakRef = null;
    let chapterTrak = null;

    // Look for tref/chap reference in audio tracks
    for (const trak of traks) {
      const tref = findAtom(moovView, trak.offset, trak.offset + trak.size, "tref");
      if (!tref) continue;
      const chap = findAtom(moovView, tref.offset, tref.offset + tref.size, "chap");
      if (chap && chap.size >= 4) {
        chapterTrakRef = moovView.getUint32(chap.offset);
        break;
      }
    }

    // Find chapter track by ID or by text handler type
    for (const trak of traks) {
      const tkhd = findAtom(moovView, trak.offset, trak.offset + trak.size, "tkhd");
      if (tkhd) {
        const version = moovView.getUint8(tkhd.offset);
        const trackId = version === 1
          ? moovView.getUint32(tkhd.offset + 20)
          : moovView.getUint32(tkhd.offset + 12);

        if (chapterTrakRef && trackId === chapterTrakRef) {
          chapterTrak = trak;
          break;
        }
      }

      const hdlr = findAtomPath(moovView, trak.offset, trak.offset + trak.size, ["mdia", "hdlr"]);
      if (hdlr && hdlr.size >= 12) {
        const handlerType = getAtomType(moovView, hdlr.offset + 8);
        if (handlerType === "text") {
          chapterTrak = trak;
        }
      }
    }

    if (!chapterTrak) return [];

    return await extractChaptersFromTrak(reader, moovView, chapterTrak);
  }

  async function extractChaptersFromTrak(reader, view, trak) {
    const mdia = findAtom(view, trak.offset, trak.offset + trak.size, "mdia");
    if (!mdia) return [];

    const mdhd = findAtom(view, mdia.offset, mdia.offset + mdia.size, "mdhd");
    if (!mdhd) return [];
    const mdhdVersion = view.getUint8(mdhd.offset);
    let timescale;
    if (mdhdVersion === 1) {
      timescale = view.getUint32(mdhd.offset + 20);
    } else {
      timescale = view.getUint32(mdhd.offset + 12);
    }
    if (!timescale) return [];

    const minf = findAtom(view, mdia.offset, mdia.offset + mdia.size, "minf");
    if (!minf) return [];
    const stbl = findAtom(view, minf.offset, minf.offset + minf.size, "stbl");
    if (!stbl) return [];

    // Get sample durations from stts
    const stts = findAtom(view, stbl.offset, stbl.offset + stbl.size, "stts");
    if (!stts) return [];
    const sttsEntryCount = view.getUint32(stts.offset + 4);
    const durations = [];
    let sttsPos = stts.offset + 8;
    for (let i = 0; i < sttsEntryCount; i++) {
      const sampleCount = view.getUint32(sttsPos);
      const sampleDuration = view.getUint32(sttsPos + 4);
      for (let j = 0; j < sampleCount; j++) {
        durations.push(sampleDuration);
      }
      sttsPos += 8;
    }

    // Get sample sizes from stsz
    const stsz = findAtom(view, stbl.offset, stbl.offset + stbl.size, "stsz");
    let sampleSizes = [];
    if (stsz) {
      const defaultSize = view.getUint32(stsz.offset + 4);
      const count = view.getUint32(stsz.offset + 8);
      if (defaultSize !== 0) {
        sampleSizes = new Array(count).fill(defaultSize);
      } else {
        let p = stsz.offset + 12;
        for (let i = 0; i < count; i++) {
          sampleSizes.push(view.getUint32(p));
          p += 4;
        }
      }
    }

    // Get chunk offsets from stco or co64
    let chunkOffsets = [];
    const stco = findAtom(view, stbl.offset, stbl.offset + stbl.size, "stco");
    const co64 = findAtom(view, stbl.offset, stbl.offset + stbl.size, "co64");
    if (stco) {
      const count = view.getUint32(stco.offset + 4);
      let p = stco.offset + 8;
      for (let i = 0; i < count; i++) {
        chunkOffsets.push(view.getUint32(p));
        p += 4;
      }
    } else if (co64) {
      const count = view.getUint32(co64.offset + 4);
      let p = co64.offset + 8;
      for (let i = 0; i < count; i++) {
        const hi = view.getUint32(p);
        const lo = view.getUint32(p + 4);
        chunkOffsets.push(hi * 0x100000000 + lo);
        p += 8;
      }
    }

    const sampleOffsets = buildSampleOffsets(view, stbl, chunkOffsets, sampleSizes);

    const chapters = [];
    let currentTime = 0;
    const numSamples = Math.min(durations.length, sampleOffsets.length, sampleSizes.length);

    for (let i = 0; i < numSamples; i++) {
      const fileOffset = sampleOffsets[i];
      const size = sampleSizes[i];
      const startSec = currentTime / timescale;

      let title = "";
      try {
        const sampleBuf = await reader.read(fileOffset, size);
        const sampleView = new DataView(sampleBuf);
        if (size >= 2) {
          const textLen = sampleView.getUint16(0);
          if (textLen > 0 && textLen <= size - 2) {
            title = new TextDecoder("utf-8").decode(new Uint8Array(sampleBuf, 2, textLen));
          } else if (size > 2) {
            title = new TextDecoder("utf-8").decode(new Uint8Array(sampleBuf)).replace(/\0/g, "").trim();
          }
        }
      } catch (e) {}
      if (!title) title = `Chapter ${i + 1}`;
      chapters.push({ title, startTime: startSec });

      currentTime += durations[i] || 0;
    }

    return chapters;
  }

  function buildSampleOffsets(view, stbl, chunkOffsets, sampleSizes) {
    const numSamples = sampleSizes.length;
    if (chunkOffsets.length >= numSamples) return chunkOffsets.slice(0, numSamples);

    const stsc = findAtom(view, stbl.offset, stbl.offset + stbl.size, "stsc");
    const stscEntries = [];
    if (stsc) {
      const count = view.getUint32(stsc.offset + 4);
      let p = stsc.offset + 8;
      for (let i = 0; i < count; i++) {
        stscEntries.push({
          firstChunk: view.getUint32(p),
          samplesPerChunk: view.getUint32(p + 4),
        });
        p += 12;
      }
    }
    if (stscEntries.length === 0) {
      stscEntries.push({ firstChunk: 1, samplesPerChunk: numSamples });
    }

    const offsets = [];
    let sampleIdx = 0;
    for (let ci = 0; ci < chunkOffsets.length && sampleIdx < numSamples; ci++) {
      let spc = stscEntries[0].samplesPerChunk;
      for (let e = stscEntries.length - 1; e >= 0; e--) {
        if (ci + 1 >= stscEntries[e].firstChunk) {
          spc = stscEntries[e].samplesPerChunk;
          break;
        }
      }
      let pos = chunkOffsets[ci];
      for (let s = 0; s < spc && sampleIdx < numSamples; s++) {
        offsets.push(pos);
        pos += sampleSizes[sampleIdx];
        sampleIdx++;
      }
    }
    return offsets;
  }

  window.ChapterParser = { parseChapters };
})();
