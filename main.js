// Roda no contexto da própria página (world: MAIN). Quando "armado" pelo content script,
// intercepta o próximo play() de áudio: silencia, captura o arquivo (blob) e pausa.
(() => {
  let armed = false;
  let armTime = 0;
  const blobs = new Map(); // object URL -> Blob

  const post = (data) => window.postMessage({ __ww: true, ...data }, "*");

  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreate.apply(this, arguments);
    try {
      if (obj instanceof Blob) {
        blobs.set(url, obj);
        if (blobs.size > 200) blobs.delete(blobs.keys().next().value);
        // fallback: áudio criado logo após armar (caso o WhatsApp não use <audio>.play)
        if (armed && /^audio\//.test(obj.type) && Date.now() - armTime < 15000) {
          setTimeout(() => { if (armed) { armed = false; post({ type: "audio", blob: obj }); } }, 1500);
        }
      }
    } catch {}
    return url;
  };

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!armed || this instanceof HTMLVideoElement) return origPlay.apply(this, arguments);
    armed = false;
    const el = this;
    const wasMuted = el.muted;
    el.muted = true;
    const p = origPlay.apply(this, arguments);
    const stop = () => {
      try { el.pause(); el.currentTime = 0; } catch {}
      setTimeout(() => { el.muted = wasMuted; }, 200);
    };
    (async () => {
      try {
        const src = el.currentSrc || el.src;
        let blob = blobs.get(src);
        if (!blob) blob = await (await fetch(src)).blob();
        post({ type: "audio", blob });
      } catch (e) {
        post({ type: "error", message: String(e && e.message ? e.message : e) });
      } finally {
        stop();
      }
    })();
    return p;
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__ww !== true) return;
    if (e.data.type === "arm") { armed = true; armTime = Date.now(); }
    if (e.data.type === "disarm") armed = false;
  });
})();
