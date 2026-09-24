(() => {
  "use strict";

  const DEFAULT_TARGETS = [
    {
      target: "./rtcw/sp_pak1.pk3",
      base: "./part/sp_pak1.pk3/sp_pak1.pk3.part",
      start: 1,
      end: 29,
      cacheName: "file-merge-cache"
    },
    {
      target: "./rtcw/pak0.pk3",
      base: "./part/pak0.pk3/pak0.pk3.part",
      start: 1,
      end: 31,
      cacheName: "file-merge-cache"
    }
  ];

  const DEFAULT_TARGET = {
    target: null,
    base: null,
    start: 1,
    end: 1,
    parts: null,
    manifestUrl: null,
    cacheName: "file-merge-cache"
  };

  const userConfig =
    typeof window !== "undefined" && window.FILE_MERGE_CONFIG
      ? window.FILE_MERGE_CONFIG
      : { targets: DEFAULT_TARGETS };

  function normalizeConfig(raw) {
    if (Array.isArray(raw.targets) && raw.targets.length > 0) {
      return raw.targets.map((t) => {
        const cfg = Object.assign({}, DEFAULT_TARGET, t);
        if (!cfg.target && cfg.targetUrl) cfg.target = cfg.targetUrl;
        if (!cfg.base && cfg.partBase) cfg.base = cfg.partBase;
        if (cfg.start == null && cfg.partStart != null) cfg.start = cfg.partStart;
        if (cfg.end == null && cfg.partEnd != null) cfg.end = cfg.partEnd;
        return cfg;
      });
    }
    const single = Object.assign({}, DEFAULT_TARGET, raw);
    if (!single.target && single.targetUrl) single.target = single.targetUrl;
    if (!single.base && single.partBase) single.base = single.partBase;
    if (single.start == null && single.partStart != null) single.start = single.partStart;
    if (single.end == null && single.partEnd != null) single.end = single.partEnd;
    return [single];
  }

  let targets = normalizeConfig(userConfig);
  const targetStates = new Map();

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch (_) {
      return url;
    }
  }

  function getOrCreateState(targetCfg) {
    const abs = toAbsoluteUrl(targetCfg.target);
    if (!targetStates.has(abs)) {
      targetStates.set(abs, {
        config: targetCfg,
        mergePromise: null,
        resolvedParts: null,
        resolvedTarget: null,
        resolvedAbsoluteTarget: null,
        progress: {
          phase: "idle",
          partIndex: 0,
          partCount: 0,
          partName: "",
          partLoaded: 0,
          partTotal: 0,
          totalLoaded: 0,
          totalExpected: 0,
          mergeOffset: 0,
          mergeTotal: 0
        }
      });
    }
    return targetStates.get(abs);
  }

  let uiRoot = null;
  let uiLog = null;
  let uiCursor = null;
  let lastUiLog = "";
  let uiStyle = null;
  let lineCount = 0;

  function bringToFront() {
    if (!uiRoot) return;
    const parent = document.documentElement || document.body;
    if (!parent) return;
    if (uiRoot.parentNode !== parent || parent.lastChild !== uiRoot) {
      parent.appendChild(uiRoot);
    }
    uiRoot.style.zIndex = "2147483647";
    uiRoot.style.display = "flex";
    uiRoot.style.visibility = "visible";
    uiRoot.style.opacity = "1";
    uiRoot.style.pointerEvents = "auto";
  }

  function ensureUI() {
    const host = document.body || document.documentElement;
    if (!host) {
      document.addEventListener("DOMContentLoaded", ensureUI, { once: true });
      return;
    }

    if (!uiStyle) {
      uiStyle = document.createElement("style");
      uiStyle.id = "filemerge-style";
      uiStyle.textContent =
        "#filemerge-overlay{position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center;justify-content:center;background:#0a0a0a!important;color:#33ff66!important;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important;margin:0!important;padding:20px!important;box-sizing:border-box!important}" +
        "#filemerge-overlay.filemerge-hide{opacity:0!important;pointer-events:none!important;transition:opacity .35s ease}" +
        "#filemerge-term{width:min(96vw,720px);max-height:86vh;display:flex;flex-direction:column;background:#0c0c0c;border:1px solid #1f3d1f;border-radius:8px;box-shadow:0 0 0 1px #0a1a0a,0 20px 60px rgba(0,0,0,.7);overflow:hidden}" +
        "#filemerge-term-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#111;border-bottom:1px solid #1a1a1a;color:#8a8a8a;font-size:12px;user-select:none}" +
        "#filemerge-term-bar .dots{display:flex;gap:6px}" +
        "#filemerge-term-bar .dot{width:10px;height:10px;border-radius:50%}" +
        "#filemerge-term-bar .dot.r{background:#ff5f56}" +
        "#filemerge-term-bar .dot.y{background:#ffbd2e}" +
        "#filemerge-term-bar .dot.g{background:#27c93f}" +
        "#filemerge-term-bar .title{flex:1;text-align:center;color:#6f6;letter-spacing:.04em}" +
        "#filemerge-log{flex:1;min-height:280px;max-height:70vh;overflow:auto;padding:14px 16px 8px;font-size:13px;line-height:1.55;color:#33ff66;white-space:pre-wrap;word-break:break-all;background:#0c0c0c}" +
        "#filemerge-log .line{margin:0 0 2px}" +
        "#filemerge-log .line.err{color:#ff6b6b}" +
        "#filemerge-log .line.info{color:#7dd3fc}" +
        "#filemerge-log .line.ok{color:#86efac}" +
        "#filemerge-prompt{padding:0 16px 14px;color:#33ff66;font-size:13px}" +
        "#filemerge-cursor{display:inline-block;width:8px;height:14px;background:#33ff66;margin-left:4px;vertical-align:-2px;animation:filemerge-blink 1s step-end infinite}" +
        "@keyframes filemerge-blink{50%{opacity:0}}";
      (document.head || document.documentElement).appendChild(uiStyle);
    }

    if (!uiRoot || !document.getElementById("filemerge-overlay")) {
      uiRoot = document.createElement("div");
      uiRoot.id = "filemerge-overlay";
      uiRoot.innerHTML =
        '<div id="filemerge-term">' +
        '<div id="filemerge-term-bar">' +
        '<div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>' +
        '<div class="title">file-merge</div></div>' +
        '<div id="filemerge-log"></div>' +
        '<div id="filemerge-prompt">$ <span id="filemerge-cursor"></span></div></div>';
      host.appendChild(uiRoot);
      lineCount = 0;
      lastUiLog = "";
    } else {
      uiRoot = document.getElementById("filemerge-overlay");
    }

    uiLog = document.getElementById("filemerge-log");
    uiCursor = document.getElementById("filemerge-cursor");
    bringToFront();
  }

  function appendLog(line, kind) {
    ensureUI();
    bringToFront();
    if (!uiLog) {
      console.log("[FileMerge]", line);
      return;
    }
    if (line === lastUiLog) return;
    lastUiLog = line;
    const time = new Date().toLocaleTimeString();
    const row = document.createElement("div");
    row.className = "line" + (kind ? " " + kind : "");
    row.textContent = "[" + time + "] " + line;
    uiLog.appendChild(row);
    lineCount++;
    while (lineCount > 400 && uiLog.firstChild) {
      uiLog.removeChild(uiLog.firstChild);
      lineCount--;
    }
    uiLog.scrollTop = uiLog.scrollHeight;
  }

  function hideUISoon() {
    if (!uiRoot) return;
    setTimeout(function () {
      if (!uiRoot) return;
      uiRoot.classList.add("filemerge-hide");
      setTimeout(function () {
        if (uiRoot && uiRoot.parentNode) uiRoot.parentNode.removeChild(uiRoot);
        uiRoot = null;
        uiLog = null;
        uiCursor = null;
      }, 400);
    }, 900);
  }

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i === 0 ? 0 : 2) + " " + units[i];
  }

  function normalizePartEntry(entry) {
    if (typeof entry === "string") return { url: entry, name: entry };
    if (entry && typeof entry === "object" && entry.url) {
      return { url: entry.url, name: entry.name || entry.url };
    }
    throw new Error("Invalid part entry: " + JSON.stringify(entry));
  }

  function generatePartsFromRange(cfg) {
    const start = Number(cfg.start);
    const end = Number(cfg.end);
    const base = cfg.base;
    if (!base) throw new Error("Missing base for target: " + cfg.target);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      throw new Error("Invalid range start=" + cfg.start + " end=" + cfg.end);
    }
    const list = [];
    for (let i = start; i <= end; i++) {
      const url = base + i;
      list.push({ url: url, name: url });
    }
    return list;
  }

  function emitProgress(state, extra) {
    const s = Object.assign({}, state.progress, extra || {});
    Object.assign(state.progress, s);

    const detail = {
      target: state.resolvedTarget || state.config.target,
      phase: s.phase,
      partIndex: s.partIndex,
      partCount: s.partCount,
      partName: s.partName,
      partLoaded: s.partLoaded,
      partTotal: s.partTotal,
      totalLoaded: s.totalLoaded,
      totalExpected: s.totalExpected,
      mergeOffset: s.mergeOffset,
      mergeTotal: s.mergeTotal,
      partLoadedText: formatBytes(s.partLoaded),
      partTotalText: formatBytes(s.partTotal),
      totalLoadedText: formatBytes(s.totalLoaded),
      totalExpectedText: formatBytes(s.totalExpected),
      mergeOffsetText: formatBytes(s.mergeOffset),
      mergeTotalText: formatBytes(s.mergeTotal)
    };

    ensureUI();
    bringToFront();

    let logLine = "";
    let kind = "";

    if (s.phase === "download") {
      logLine =
        "recv " +
        (s.partIndex + 1) +
        "/" +
        s.partCount +
        "  " +
        s.partName +
        "  " +
        detail.partLoadedText +
        (s.partTotal ? " / " + detail.partTotalText : "") +
        "  total " +
        detail.totalLoadedText +
        (s.totalExpected ? " / " + detail.totalExpectedText : "");
    } else if (s.phase === "merge") {
      logLine = "merge  " + detail.mergeOffsetText + " / " + detail.mergeTotalText;
    } else if (s.phase === "done") {
      logLine = "done   " + detail.totalLoadedText + "  → " + detail.target;
      kind = "ok";
    }

    if (logLine) {
      appendLog(logLine, kind);
      console.log("[FileMerge] " + logLine);
    }

    if (typeof state.config.onProgress === "function") {
      try {
        state.config.onProgress(detail);
      } catch (_) {}
    }

    try {
      window.dispatchEvent(new CustomEvent("filemerge-progress", { detail: detail }));
    } catch (_) {}
  }

  async function loadManifest(state) {
    const cfg = state.config;

    if (Array.isArray(cfg.parts) && cfg.parts.length > 0) {
      state.resolvedParts = cfg.parts.map(normalizePartEntry);
      state.resolvedTarget = cfg.target;
      state.resolvedAbsoluteTarget = toAbsoluteUrl(state.resolvedTarget);
      return;
    }

    if (cfg.base != null && cfg.start != null && cfg.end != null) {
      state.resolvedParts = generatePartsFromRange(cfg);
      state.resolvedTarget = cfg.target;
      state.resolvedAbsoluteTarget = toAbsoluteUrl(state.resolvedTarget);
      appendLog(
        "parts " +
          cfg.start +
          ".." +
          cfg.end +
          " count=" +
          state.resolvedParts.length +
          " → " +
          state.resolvedTarget,
        "info"
      );
      return;
    }

    if (!cfg.manifestUrl) {
      throw new Error("No parts/base/manifest for target: " + cfg.target);
    }

    appendLog("read manifest " + cfg.manifestUrl, "info");
    const res = await window.__fileMergeNativeFetch(cfg.manifestUrl, {
      cache: "no-store"
    });
    if (!res.ok) {
      throw new Error("Manifest failed: " + cfg.manifestUrl + " " + res.status);
    }

    const json = await res.json();
    if (!json || !Array.isArray(json.parts) || json.parts.length === 0) {
      throw new Error("Manifest missing parts");
    }

    state.resolvedParts = json.parts.map(normalizePartEntry);
    state.resolvedTarget = json.target || json.targetUrl || cfg.target;
    state.resolvedAbsoluteTarget = toAbsoluteUrl(state.resolvedTarget);

    if (!state.resolvedTarget) throw new Error("Manifest missing target");

    appendLog(
      "manifest ok parts=" +
        state.resolvedParts.length +
        " target=" +
        state.resolvedTarget,
      "info"
    );
  }

  async function fetchPartWithProgress(state, part, partIndex, partCount, baseLoaded) {
    const res = await window.__fileMergeNativeFetch(part.url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Part failed: " + part.name + " " + res.status);
    }

    const totalHeader = Number(res.headers.get("content-length")) || 0;

    if (!res.body || !res.body.getReader) {
      const buf = await res.arrayBuffer();
      emitProgress(state, {
        phase: "download",
        partIndex: partIndex,
        partCount: partCount,
        partName: part.name,
        partLoaded: buf.byteLength,
        partTotal: buf.byteLength,
        totalLoaded: baseLoaded + buf.byteLength,
        totalExpected: state.progress.totalExpected || baseLoaded + buf.byteLength
      });
      return buf;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastEmit = 0;

    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.byteLength;
      const now = Date.now();
      if (now - lastEmit >= 100 || (totalHeader && loaded >= totalHeader)) {
        lastEmit = now;
        emitProgress(state, {
          phase: "download",
          partIndex: partIndex,
          partCount: partCount,
          partName: part.name,
          partLoaded: loaded,
          partTotal: totalHeader,
          totalLoaded: baseLoaded + loaded,
          totalExpected: state.progress.totalExpected
        });
      }
    }

    const out = new Uint8Array(loaded);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }

    emitProgress(state, {
      phase: "download",
      partIndex: partIndex,
      partCount: partCount,
      partName: part.name,
      partLoaded: loaded,
      partTotal: totalHeader || loaded,
      totalLoaded: baseLoaded + loaded,
      totalExpected: state.progress.totalExpected
    });

    return out.buffer;
  }

  async function mergeOneTarget(targetCfg) {
    const state = getOrCreateState(targetCfg);

    if (state.mergePromise) return state.mergePromise;

    state.mergePromise = (async () => {
      ensureUI();
      bringToFront();
      appendLog("start → " + targetCfg.target, "info");

      await loadManifest(state);

      const targetUrl = state.resolvedTarget;
      const parts = state.resolvedParts;
      const cacheName = targetCfg.cacheName || "file-merge-cache";

      appendLog("target " + targetUrl, "info");
      appendLog("parts  " + parts.length, "info");

      const cache = await caches.open(cacheName);
      let cached =
        (await cache.match(targetUrl)) ||
        (await cache.match(state.resolvedAbsoluteTarget));

      if (cached) {
        appendLog("cache hit → " + targetUrl, "ok");
        const len = Number(cached.headers.get("content-length")) || 0;
        emitProgress(state, {
          phase: "done",
          partIndex: parts.length - 1,
          partCount: parts.length,
          partName: "cache",
          partLoaded: len,
          partTotal: len,
          totalLoaded: len,
          totalExpected: len,
          mergeOffset: len,
          mergeTotal: len
        });
        return cached;
      }

      appendLog("download → " + targetUrl, "info");
      emitProgress(state, {
        phase: "download",
        partIndex: 0,
        partCount: parts.length,
        partName: parts[0].name,
        partLoaded: 0,
        partTotal: 0,
        totalLoaded: 0,
        totalExpected: 0,
        mergeOffset: 0,
        mergeTotal: 0
      });

      const buffers = [];
      let totalLoaded = 0;

      for (let i = 0; i < parts.length; i++) {
        const buf = await fetchPartWithProgress(
          state,
          parts[i],
          i,
          parts.length,
          totalLoaded
        );
        buffers.push(buf);
        totalLoaded += buf.byteLength;
        emitProgress(state, {
          phase: "download",
          partIndex: i,
          partCount: parts.length,
          partName: parts[i].name,
          partLoaded: buf.byteLength,
          partTotal: buf.byteLength,
          totalLoaded: totalLoaded,
          totalExpected:
            state.progress.totalExpected > totalLoaded
              ? state.progress.totalExpected
              : totalLoaded
        });
      }

      let totalSize = 0;
      for (let i = 0; i < buffers.length; i++) totalSize += buffers[i].byteLength;

      appendLog("merge " + formatBytes(totalSize) + " → " + targetUrl, "info");
      emitProgress(state, {
        phase: "merge",
        partIndex: parts.length - 1,
        partCount: parts.length,
        partName: "merge",
        partLoaded: totalSize,
        partTotal: totalSize,
        totalLoaded: totalSize,
        totalExpected: totalSize,
        mergeOffset: 0,
        mergeTotal: totalSize
      });

      const mergedArray = new Uint8Array(totalSize);
      let offset = 0;
      let lastEmit = 0;

      for (let i = 0; i < buffers.length; i++) {
        mergedArray.set(new Uint8Array(buffers[i]), offset);
        offset += buffers[i].byteLength;
        const now = Date.now();
        if (now - lastEmit >= 50 || offset === totalSize) {
          lastEmit = now;
          emitProgress(state, {
            phase: "merge",
            mergeOffset: offset,
            mergeTotal: totalSize,
            totalLoaded: totalSize,
            totalExpected: totalSize
          });
        }
      }

      appendLog("done " + totalSize + " bytes → " + targetUrl, "ok");

      const finalResponse = new Response(mergedArray, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(mergedArray.byteLength)
        }
      });

      await cache.put(targetUrl, finalResponse.clone());
      await cache.put(state.resolvedAbsoluteTarget, finalResponse.clone());
      appendLog("cached → " + targetUrl, "ok");

      emitProgress(state, {
        phase: "done",
        mergeOffset: totalSize,
        mergeTotal: totalSize,
        totalLoaded: totalSize,
        totalExpected: totalSize
      });

      return finalResponse;
    })();

    try {
      return await state.mergePromise;
    } catch (error) {
      state.mergePromise = null;
      ensureUI();
      bringToFront();
      appendLog("error " + (error && error.message ? error.message : error), "err");
      throw error;
    }
  }

  function isTargetRequest(input) {
    let reqUrl = "";
    if (typeof input === "string") {
      reqUrl = toAbsoluteUrl(input);
    } else if (input && typeof input.url === "string") {
      reqUrl = toAbsoluteUrl(input.url);
    } else {
      return null;
    }

    const cleanReq = reqUrl.split("#")[0].split("?")[0];

    for (const targetCfg of targets) {
      const state = getOrCreateState(targetCfg);
      const absTarget =
        state.resolvedAbsoluteTarget || toAbsoluteUrl(targetCfg.target);
      const cleanTarget = absTarget.split("#")[0].split("?")[0];

      if (cleanReq === cleanTarget) return targetCfg;

      const name = (targetCfg.target || "").split("/").pop();
      if (name && cleanReq.endsWith("/" + name)) return targetCfg;
    }
    return null;
  }

  const nativeFetch = window.fetch.bind(window);
  window.__fileMergeNativeFetch = nativeFetch;

  window.fetch = async function (input, init) {
    const matched = isTargetRequest(input);
    if (matched) {
      appendLog("intercept → " + matched.target, "info");
      const res = await mergeOneTarget(matched);
      return res.clone();
    }
    return nativeFetch(input, init);
  };

  window.FileMergeLoader = {
    load: function (targetOrUrl) {
      if (!targetOrUrl) {
        return Promise.all(targets.map((t) => mergeOneTarget(t)));
      }
      if (typeof targetOrUrl === "string") {
        const found = targets.find(
          (t) =>
            t.target === targetOrUrl ||
            toAbsoluteUrl(t.target) === toAbsoluteUrl(targetOrUrl)
        );
        if (!found) return Promise.reject(new Error("Unknown target: " + targetOrUrl));
        return mergeOneTarget(found);
      }
      return mergeOneTarget(Object.assign({}, DEFAULT_TARGET, targetOrUrl));
    },

    getTargets: function () {
      return targets.map((t) => Object.assign({}, t));
    },

    setTargets: function (next) {
      if (!Array.isArray(next)) throw new Error("setTargets expects array");
      targets = next.map((t) => Object.assign({}, DEFAULT_TARGET, t));
      targetStates.clear();
    },

    getConfig: function () {
      return targets.length === 1
        ? Object.assign({}, targets[0])
        : { targets: targets.map((t) => Object.assign({}, t)) };
    },

    setConfig: function (next) {
      targets = normalizeConfig(next || {});
      targetStates.clear();
    },

    getProgress: function (targetUrl) {
      if (targetUrl) {
        const abs = toAbsoluteUrl(targetUrl);
        const state = targetStates.get(abs);
        return state ? Object.assign({}, state.progress) : null;
      }
      const result = {};
      targetStates.forEach((state, key) => {
        result[key] = Object.assign({}, state.progress);
      });
      return result;
    }
  };

  const keepTopTimer = setInterval(function () {
    if (!uiRoot || !document.getElementById("filemerge-overlay")) return;
    let anyRunning = false;
    targetStates.forEach((state) => {
      if (state.progress.phase !== "idle" && state.progress.phase !== "done") {
        anyRunning = true;
      }
    });
    if (!anyRunning) {
      clearInterval(keepTopTimer);
      hideUISoon();
      return;
    }
    bringToFront();
  }, 300);

  if (document.body || document.documentElement) {
    ensureUI();
  } else {
    document.addEventListener("DOMContentLoaded", ensureUI, { once: true });
  }

  Promise.all(
    targets.map((t) =>
      mergeOneTarget(t).catch(function (error) {
        console.error("[FileMerge] failed", t.target, error);
      })
    )
  ).then(function () {
    appendLog("all targets done", "ok");
  });

  console.log("[FileMerge] ready (" + targets.length + " target(s))");
})();
