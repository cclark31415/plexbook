(function () {
  "use strict";

  async function parseChapters(file) {
    const buf = await readFileHeader(file, 50 * 1024 * 1024);
    const view = new DataView(buf);

    const moov = findAtom(view, 0, buf.byteLength, "moov");
    if (!moov) return [];

    const chpl = findChplChapters(view, moov.offset, moov.size);
    if (chpl.length > 0) return chpl;

    return findQuickTimeChapters(view, buf, moov.offset, moov.size);
  }

  function readFileHeader(file, maxBytes) {
    const size = Math.min(file.size, maxBytes);
    const slice = file.slice(0, size);
    return slice.arrayBuffer();
  }

  function readUTF8(view, offset, length) {
    const bytes = new Uint8Array(view.buffer, offset, length);
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

  // Nero chapter format: moov > udta > chpl
  function findChplChapters(view, moovOffset, moovSize) {
    const chpl = findAtomPath(view, moovOffset, moovOffset + moovSize, ["udta", "chpl"]);
    if (!chpl) return [];

    const chapters = [];
    let pos = chpl.offset;
    const end = chpl.offset + chpl.size;

    if (pos + 8 > end) return [];
    pos += 4; // version
    pos += 4; // unknown

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
  function findQuickTimeChapters(view, buf, moovOffset, moovSize) {
    const traks = findAllAtoms(view, moovOffset, moovOffset + moovSize, "trak");

    let chapterTrakRef = null;
    let chapterTrak = null;

    // Look for a tref/chap reference in audio tracks to find the chapter track ID
    for (const trak of traks) {
      const tref = findAtom(view, trak.offset, trak.offset + trak.size, "tref");
      if (!tref) continue;
      const chap = findAtom(view, tref.offset, tref.offset + tref.size, "chap");
      if (chap && chap.size >= 4) {
        chapterTrakRef = view.getUint32(chap.offset);
        break;
      }
    }

    // Find chapter track by ID or by handler type 'text'
    for (const trak of traks) {
      const tkhd = findAtom(view, trak.offset, trak.offset + trak.size, "tkhd");
      if (tkhd) {
        const version = view.getUint8(tkhd.offset);
        const trackId = version === 1
          ? view.getUint32(tkhd.offset + 20)
          : view.getUint32(tkhd.offset + 12);

        if (chapterTrakRef && trackId === chapterTrakRef) {
          chapterTrak = trak;
          break;
        }
      }

      // Fallback: check if this is a text handler track
      const hdlr = findAtomPath(view, trak.offset, trak.offset + trak.size, ["mdia", "hdlr"]);
      if (hdlr && hdlr.size >= 12) {
        const handlerType = getAtomType(view, hdlr.offset + 8);
        if (handlerType === "text") {
          chapterTrak = trak;
          // Don't break — prefer tref match
        }
      }
    }

    if (!chapterTrak) return [];

    return extractChaptersFromTrak(view, buf, chapterTrak);
  }

  function extractChaptersFromTrak(view, buf, trak) {
    const mdia = findAtom(view, trak.offset, trak.offset + trak.size, "mdia");
    if (!mdia) return [];

    // Get timescale from mdhd
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

    // Get sample offsets from stco or co64
    let sampleOffsets = [];
    const stco = findAtom(view, stbl.offset, stbl.offset + stbl.size, "stco");
    const co64 = findAtom(view, stbl.offset, stbl.offset + stbl.size, "co64");
    if (stco) {
      const count = view.getUint32(stco.offset + 4);
      let p = stco.offset + 8;
      for (let i = 0; i < count; i++) {
        sampleOffsets.push(view.getUint32(p));
        p += 4;
      }
    } else if (co64) {
      const count = view.getUint32(co64.offset + 4);
      let p = co64.offset + 8;
      for (let i = 0; i < count; i++) {
        const hi = view.getUint32(p);
        const lo = view.getUint32(p + 4);
        sampleOffsets.push(hi * 0x100000000 + lo);
        p += 8;
      }
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

    // Build chapters from sample data
    const chapters = [];
    let currentTime = 0;
    const numSamples = Math.min(durations.length, sampleOffsets.length, sampleSizes.length);

    for (let i = 0; i < numSamples; i++) {
      const offset = sampleOffsets[i];
      const size = sampleSizes[i];
      const startSec = currentTime / timescale;

      if (offset + size <= buf.byteLength) {
        let title = "";
        // Text samples may have a 2-byte length prefix
        if (size >= 2) {
          const textLen = view.getUint16(offset);
          if (textLen > 0 && textLen <= size - 2 && offset + 2 + textLen <= buf.byteLength) {
            title = readUTF8(view, offset + 2, textLen);
          } else if (size > 2) {
            title = readUTF8(view, offset, size).replace(/\0/g, "").trim();
          }
        }
        if (!title) title = `Chapter ${i + 1}`;
        chapters.push({ title, startTime: startSec });
      }

      currentTime += durations[i] || 0;
    }

    return chapters;
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

  window.ChapterParser = { parseChapters };
})();
