(() => {
  "use strict";

  const AUDIO = Object.fromEntries(Array.from({ length: 21 }, (_, i) => {
    const q = String(i + 1).padStart(2, "0");
    const ext = ["04", "17", "19"].includes(q) ? "wav" : "mp3";
    return [i + 1, `audio/Q${q}.${ext}`];
  }));
  const SHELL = ["./", "index.html", "styles.css?v=4-blue-master-fo", "app.js?v=4-blue-master-fo", "script-data.js", "manifest.webmanifest?v=home-icon", "QPON_LOGO.png", "zico-hihan-logo-white.png", "QPON-home-icon.png"];
  const STORE_KEY = "qpon-project-z-settings-v1";
  const defaults = { masterVolume: 1, masterFoSeconds: 3, cues: {} };
  const saved = loadSettings();
  let ctx;
  let masterGain;
  let buffers = new Map();
  const active = new Set();
  const activeByCue = new Map();
  const pendingByCue = new Map();
  const cueElements = new Map();
  let masterFoVisualRun = 0;

  const $ = (s) => document.querySelector(s);
  const status = $("#systemStatus");
  const detail = $("#prepDetail");
  const masterVolume = $("#masterVolume");
  const masterVolumeValue = $("#masterVolumeValue");
  const masterFoSeconds = $("#masterFoSeconds");
  const masterFoPreset = $("#masterFoPreset");
  const masterFoButton = $("#masterFo");
  const customFoWrap = $("#customFoWrap");

  renderScript();
  restoreControls();
  bindControls();
  registerWorker();
  checkOffline();

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; }
    catch { return structuredClone(defaults); }
  }

  function saveSettings() {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  }

  function cueSettings(q) {
    return saved.cues[q] ||= { volume: 1, fi: false, fiSeconds: 1 };
  }

  function setCueAssetStatus(q, type, text, state = "pending") {
    const el = cueElements.get(Number(q));
    const target = el?.querySelector(type === "offline" ? ".cue-offline-status" : ".cue-load-status");
    if (!target) return;
    target.textContent = text;
    target.className = `${type === "offline" ? "cue-offline-status" : "cue-load-status"} ${state}`;
  }

  function renderScript() {
    const root = $("#script");
    const template = $("#cueTemplate");
    for (const item of window.QPON_SCRIPT) {
      if (item.cue) {
        const q = item.cue;
        const node = template.content.firstElementChild.cloneNode(true);
        node.dataset.q = q;
        node.querySelector(".cue-number").textContent = `Q${String(q).padStart(2, "0")}`;
        node.querySelector(".cue-copy").textContent = item.text.replace(/【Q\d{2}】\s*/, "");
        const settings = cueSettings(q);
        const volume = node.querySelector(".cue-volume");
        const volumeOut = node.querySelector(".cue-volume-value");
        const fi = node.querySelector(".cue-fi");
        const fiSeconds = node.querySelector(".cue-fi-seconds");
        volume.value = settings.volume;
        volumeOut.value = `${Math.round(settings.volume * 100)}%`;
        fi.checked = settings.fi;
        fiSeconds.value = settings.fiSeconds;
        node.querySelector(".cue-trigger").addEventListener("click", () => toggleCue(q));
        volume.addEventListener("input", () => {
          settings.volume = Number(volume.value);
          volumeOut.value = `${Math.round(settings.volume * 100)}%`;
          saveSettings();
        });
        fi.addEventListener("change", () => { settings.fi = fi.checked; saveSettings(); });
        fiSeconds.addEventListener("input", () => {
          const seconds = Number(fiSeconds.value);
          if (!Number.isFinite(seconds) || seconds < .1 || seconds > 30) return;
          settings.fiSeconds = seconds;
          saveSettings();
        });
        fiSeconds.addEventListener("change", () => {
          settings.fiSeconds = clamp(Number(fiSeconds.value) || 1, .1, 30);
          fiSeconds.value = settings.fiSeconds;
          saveSettings();
        });
        cueElements.set(q, node);
        root.append(node);
      } else {
        const p = document.createElement(item.style === "柱・シーン" ? "h2" : "p");
        p.className = item.style === "柱・シーン" ? "script-line scene" : "script-line dialogue";
        formatLine(p, item.text);
        root.append(p);
      }
    }
  }

  function formatLine(el, text) {
    const parts = text.split("\t");
    if (parts.length > 1 && parts[0].trim()) {
      const speaker = document.createElement("span");
      speaker.className = "speaker";
      speaker.textContent = `${parts.shift().trim()}　`;
      el.append(speaker, document.createTextNode(parts.join("　").trim()));
    } else {
      el.textContent = text.trim();
      if (/^[　\s]*(しばし|心の声|力を|手が|お互い|茅野、|川辺、|暗転)/.test(text)) el.classList.add("stage");
    }
  }

  function restoreControls() {
    masterVolume.value = saved.masterVolume;
    masterVolumeValue.value = `${Math.round(saved.masterVolume * 100)}%`;
    masterFoSeconds.value = saved.masterFoSeconds;
    const preset = [1, 2, 3, 5, 10].includes(Number(saved.masterFoSeconds)) ? String(saved.masterFoSeconds) : "custom";
    masterFoPreset.value = preset;
    customFoWrap.hidden = preset !== "custom";
  }

  function bindControls() {
    $("#prepareAudio").addEventListener("click", prepareAudio);
    $("#prepareOffline").addEventListener("click", prepareOffline);
    $("#stopAll").addEventListener("click", stopAll);
    $("#masterFo").addEventListener("click", masterFadeOut);
    masterVolume.addEventListener("input", () => {
      saved.masterVolume = Number(masterVolume.value);
      masterVolumeValue.value = `${Math.round(saved.masterVolume * 100)}%`;
      if (masterGain && ctx) masterGain.gain.setValueAtTime(saved.masterVolume, ctx.currentTime);
      saveSettings();
    });
    masterFoPreset.addEventListener("change", () => {
      const custom = masterFoPreset.value === "custom";
      customFoWrap.hidden = !custom;
      if (custom) {
        masterFoSeconds.focus();
        return;
      }
      saved.masterFoSeconds = Number(masterFoPreset.value);
      masterFoSeconds.value = saved.masterFoSeconds;
      saveSettings();
    });
    masterFoSeconds.addEventListener("input", () => {
      const seconds = Number(masterFoSeconds.value);
      if (!Number.isFinite(seconds) || seconds < .1 || seconds > 30) return;
      saved.masterFoSeconds = seconds;
      saveSettings();
    });
    masterFoSeconds.addEventListener("change", () => {
      saved.masterFoSeconds = clamp(Number(masterFoSeconds.value) || 3, .1, 30);
      masterFoSeconds.value = saved.masterFoSeconds;
      saveSettings();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ctx?.state === "suspended") ctx.resume();
    });
  }

  async function ensureAudio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      masterGain = ctx.createGain();
      masterGain.gain.value = saved.masterVolume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state !== "running") await ctx.resume();
  }

  async function prepareAudio() {
    await ensureAudio();
    setStatus("pending", "音源 準備中");
    const failures = [];
    for (const [q, url] of Object.entries(AUDIO)) {
      if (buffers.has(Number(q))) continue;
      detail.textContent = `音源を読み込み・展開中 ${buffers.size + 1}/21：Q${String(q).padStart(2, "0")}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        buffers.set(Number(q), await ctx.decodeAudioData(arrayBuffer));
        setCueAssetStatus(q, "load", "音源：読み込み成功", "success");
      } catch (error) {
        failures.push(`Q${q}: ${error.message}`);
        setCueAssetStatus(q, "load", "音源：読込失敗", "error");
      }
      await new Promise(requestAnimationFrame);
    }
    if (failures.length) {
      setStatus("error", `音源エラー ${failures.length}`);
      detail.textContent = failures.join(" / ");
    } else {
      setStatus("ready", "音源 21/21 準備完了");
      detail.textContent = "低遅延再生の準備が完了しました";
    }
  }

  async function toggleCue(q) {
    const playing = activeByCue.get(q);
    if (playing) {
      stopVoice(playing);
      return;
    }
    const pending = pendingByCue.get(q);
    if (pending) {
      pending.cancelled = true;
      pendingByCue.delete(q);
      if (!buffers.has(q)) setCueAssetStatus(q, "load", "音源：未読込", "pending");
      refreshPlaying();
      return;
    }
    const request = { cancelled: false };
    pendingByCue.set(q, request);
    refreshPlaying();
    await ensureAudio();
    if (!buffers.has(q)) {
      detail.textContent = `Q${String(q).padStart(2, "0")}を準備しています…`;
      setCueAssetStatus(q, "load", "音源：読込中", "working");
      try {
        const response = await fetch(AUDIO[q]);
        buffers.set(q, await ctx.decodeAudioData(await response.arrayBuffer()));
        setCueAssetStatus(q, "load", "音源：読み込み成功", "success");
      } catch {
        pendingByCue.delete(q);
        setStatus("error", `Q${String(q).padStart(2, "0")} 読込失敗`);
        setCueAssetStatus(q, "load", "音源：読込失敗", "error");
        refreshPlaying();
        return;
      }
    }
    if (request.cancelled || pendingByCue.get(q) !== request) return;
    pendingByCue.delete(q);
    const settings = cueSettings(q);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffers.get(q);
    source.connect(gain).connect(masterGain);
    const now = ctx.currentTime;
    if (settings.fi) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(settings.volume, now + settings.fiSeconds);
    } else {
      gain.gain.setValueAtTime(settings.volume, now);
    }
    const voice = { q, source, gain };
    active.add(voice);
    activeByCue.set(q, voice);
    source.onended = () => {
      active.delete(voice);
      if (activeByCue.get(q) === voice) activeByCue.delete(q);
      refreshPlaying();
    };
    source.start(now);
    refreshPlaying();
  }

  function stopVoice(voice) {
    const now = ctx?.currentTime || 0;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.source.stop(now);
    } catch {}
    active.delete(voice);
    if (activeByCue.get(voice.q) === voice) activeByCue.delete(voice.q);
    refreshPlaying();
  }

  function stopAll() {
    masterFoVisualRun += 1;
    setMasterFoVisual(false);
    for (const voice of [...active]) {
      stopVoice(voice);
    }
    for (const request of pendingByCue.values()) request.cancelled = true;
    pendingByCue.clear();
    if (masterGain && ctx) {
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setValueAtTime(saved.masterVolume, ctx.currentTime);
    }
    refreshPlaying();
  }

  async function masterFadeOut() {
    await ensureAudio();
    if (!active.size) return;
    const seconds = clamp(Number(saved.masterFoSeconds) || 3, .1, 30);
    const visualRun = ++masterFoVisualRun;
    setMasterFoVisual(true);
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + seconds);
    const voices = [...active];
    for (const voice of voices) {
      try { voice.source.stop(now + seconds + .03); } catch {}
    }
    window.setTimeout(() => {
      if (visualRun === masterFoVisualRun) setMasterFoVisual(false);
      if (!masterGain || !ctx) return;
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setValueAtTime(saved.masterVolume, ctx.currentTime);
      refreshPlaying();
    }, seconds * 1000 + 100);
  }

  function setMasterFoVisual(running) {
    masterFoButton.classList.toggle("fo-running", running);
    masterFoButton.setAttribute("aria-pressed", String(running));
    masterFoButton.textContent = running ? "FO実行中" : "MASTER FO";
  }

  function refreshPlaying() {
    const counts = new Map();
    for (const voice of active) counts.set(voice.q, (counts.get(voice.q) || 0) + 1);
    for (const [q, el] of cueElements) {
      const count = counts.get(q) || 0;
      el.classList.toggle("playing", count > 0);
      const pending = pendingByCue.has(q);
      el.querySelector(".cue-state").textContent = count ? "PLAYING・再押下で停止" : pending ? "LOADING・再押下で取消" : "READY";
    }
    const labels = [...counts].sort((a,b) => a[0]-b[0]).map(([q]) => `Q${String(q).padStart(2,"0")}`);
    $("#activeList").textContent = `再生中：${labels.join(" / ") || "なし"}`;
  }

  async function prepareOffline() {
    if (!("caches" in window)) {
      setStatus("error", "オフライン非対応");
      return;
    }
    setStatus("pending", "オフライン保存中");
    try {
      const cache = await caches.open("qpon-project-z-v4-blue-offline-count");
      detail.textContent = "画面データを準備中…";
      for (const asset of SHELL) {
        const response = await fetch(asset, { cache: "reload" });
        if (!response.ok) throw new Error(`${asset} (${response.status})`);
        await cache.put(asset, response);
      }
      const audioEntries = Object.entries(AUDIO);
      for (let i = 0; i < audioEntries.length; i++) {
        const [q, url] = audioEntries[i];
        detail.textContent = `音源を保存中 ${i + 1}/21`;
        const response = await fetch(url, { cache: "reload" });
        if (!response.ok) throw new Error(`${url} (${response.status})`);
        await cache.put(url, response);
        setCueAssetStatus(q, "offline", "オフライン：保存済み", "success");
      }
      setStatus("ready", "オフライン準備完了 21/21");
      detail.textContent = "機内モードでも台本と全音源を使用できます";
    } catch (error) {
      setStatus("error", "オフライン保存失敗");
      detail.textContent = error.message;
    }
  }

  async function checkOffline() {
    if (!("caches" in window)) return;
    const cache = await caches.open("qpon-project-z-v4-blue-offline-count");
    const entries = Object.entries(AUDIO);
    const checks = await Promise.all(entries.map(([, url]) => cache.match(url)));
    checks.forEach((match, index) => setCueAssetStatus(entries[index][0], "offline", match ? "オフライン：保存済み" : "オフライン：未保存", match ? "success" : "pending"));
    const count = checks.filter(Boolean).length;
    if (count === 21) setStatus("ready", "オフライン準備完了 21/21");
    else if (count) setStatus("pending", `オフライン ${count}/21`);
  }

  async function registerWorker() {
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("service-worker.js"); } catch {}
    }
  }

  function setStatus(kind, text) { status.className = `status ${kind}`; status.textContent = text; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
})();
