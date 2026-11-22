// Content script do WhatsApp Web: injeta o botão "Transcrever" nas mensagens de áudio.
(() => {
  const ICON_SELECTOR = [
    '[data-icon^="audio-"]',
    '[data-icon="ptt-status"]',
    '[data-icon*="ptt"]',
    'button[aria-label*="Reproduzir" i]',
    'button[aria-label*="Play" i]',
    'button[aria-label*="Reproducir" i]',
    '[role="button"][aria-label*="Reproduzir" i]',
    '[role="button"][aria-label*="Play" i]',
    '[role="slider"]',
    'input[type="range"]',
  ].join(", ");
  const rowOf = (el) => el.closest('[data-id]') || el.closest('[role="row"]') || el.closest('[role="listitem"]');
  let detected = 0;
  const activeStatus = new Set(); // elementos de status aguardando progresso
  let queue = Promise.resolve();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "progress") return;
    const text =
      msg.phase === "download" ? `Baixando modelo… ${msg.pct}% (só na primeira vez)` :
      msg.phase === "load" ? "Carregando modelo…" :
      `Transcrevendo… (${msg.device === "webgpu" ? "GPU" : "CPU"})`;
    activeStatus.forEach((el) => (el.textContent = text));
  });

  function b64FromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function findPlayButton(row, icon) {
    const cands = row.querySelectorAll(
      '[data-icon="audio-play"], [data-icon="audio-download"], button[aria-label*="Reproduzir" i], button[aria-label*="Play" i], [role="button"][aria-label*="Reproduzir" i], [role="button"][aria-label*="Play" i]'
    );
    const el = cands[0] || icon;
    return el.closest('button, [role="button"]') || el;
  }

  // O WhatsApp só carrega/decifra o áudio ao dar play. O main.js (contexto da página)
  // intercepta esse play, silencia, nos entrega o arquivo e pausa.
  function grabAudioBuffer(row, icon) {
    return new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.__ww !== true) return;
        if (e.data.type === "audio") { done(); e.data.blob.arrayBuffer().then(resolve, reject); }
        if (e.data.type === "error") { done(); reject(new Error(e.data.message)); }
      };
      const timer = setTimeout(() => {
        done();
        window.postMessage({ __ww: true, type: "disarm" }, "*");
        reject(new Error("não consegui capturar o áudio (tempo esgotado)"));
      }, 20000);
      const done = () => { clearTimeout(timer); window.removeEventListener("message", onMsg); };
      window.addEventListener("message", onMsg);
      window.postMessage({ __ww: true, type: "arm" }, "*");
      findPlayButton(row, icon).click();
    });
  }

  function transcribeRow(row, icon, statusEl) {
    return (queue = queue.then(async () => {
      activeStatus.add(statusEl);
      try {
        statusEl.textContent = "Obtendo áudio…";
        const buf = await grabAudioBuffer(row, icon);
        statusEl.textContent = "Enviando para o Whisper…";
        const res = await chrome.runtime.sendMessage({ type: "transcribe", b64: b64FromBuffer(buf) });
        if (!res || res.error) throw new Error(res ? res.error : "sem resposta da extensão");
        return res.text;
      } finally {
        activeStatus.delete(statusEl);
      }
    }));
  }

  // Estado por mensagem (sobrevive ao WhatsApp redesenhar o DOM):
  // { status: "idle" | "busy" | "done" | "error", text }
  const state = new Map();
  const rowIds = new WeakMap();
  const idOf = (row) => {
    let id = row.getAttribute("data-id") || rowIds.get(row);
    if (!id) { id = "ww-" + Math.random().toString(36).slice(2); rowIds.set(row, id); }
    return id;
  };

  function render(box) {
    const st = state.get(box.dataset.wwId) || { status: "idle" };
    const btn = box.querySelector(".ww-btn");
    const out = box.querySelector(".ww-out");
    if (st.status !== "busy") activeStatus.delete(out);
    activeStatus.forEach((el) => { if (!el.isConnected) activeStatus.delete(el); });
    out.classList.toggle("ww-err", st.status === "error");
    btn.style.display = st.status === "done" ? "none" : "";
    btn.disabled = st.status === "busy";
    btn.textContent = st.status === "error" ? "Tentar de novo" : "📝 Transcrever";
    if (st.status === "done") out.textContent = st.text;
    else if (st.status === "error") out.textContent = "Erro: " + st.text;
    else if (st.status === "idle") out.textContent = "";
    // "busy": o texto de progresso é atualizado por activeStatus
  }

  const boxesFor = (id) => document.querySelectorAll(`.ww-box[data-ww-id="${CSS.escape(id)}"]`);

  function inject(icon) {
    const row = rowOf(icon);
    if (!row || row.querySelector(".ww-box")) return;
    if (row.querySelector("video")) return;
    if (!icon.isConnected || icon.offsetWidth === 0) return; // ainda não desenhado: tenta no próximo scan
    // âncora: ancestral largo o bastante para ser a linha do player, sempre DENTRO da mensagem
    let anchor = icon;
    while (anchor.parentElement && anchor.parentElement !== row && anchor.offsetWidth < 180) anchor = anchor.parentElement;
    if (!row.contains(anchor) || anchor === row) return;

    const id = idOf(row);
    const box = document.createElement("div");
    box.className = "ww-box";
    box.dataset.wwId = id;
    const btn = document.createElement("button");
    btn.className = "ww-btn";
    const out = document.createElement("div");
    out.className = "ww-out";
    box.append(btn, out);
    anchor.insertAdjacentElement("afterend", box);
    render(box);
    if ((state.get(id) || {}).status === "busy") { out.textContent = "Transcrevendo…"; activeStatus.add(out); }

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if ((state.get(id) || {}).status === "busy") return;
      state.set(id, { status: "busy" });
      render(box);
      try {
        // a mensagem pode ter sido redesenhada: usa a linha/ícone atuais
        const curBox = boxesFor(id)[0] || box;
        const curRow = rowOf(curBox) || row;
        const curIcon = curRow.querySelector(ICON_SELECTOR) || icon;
        const text = await transcribeRow(curRow, curIcon, out);
        state.set(id, { status: "done", text: text || "(sem fala detectada)" });
      } catch (err) {
        state.set(id, { status: "error", text: err.message || String(err) });
      }
      boxesFor(id).forEach(render);
    });
  }

  // Indicador + diagnóstico: clique para copiar informações do DOM (sem conteúdo de mensagens).
  const badge = document.createElement("div");
  badge.className = "ww-badge";
  badge.title = "Clique para copiar diagnóstico";
  document.documentElement.appendChild(badge);
  badge.addEventListener("click", async () => {
    const icons = [...new Set([...document.querySelectorAll("[data-icon]")].map((e) => e.getAttribute("data-icon")))];
    const labels = [...new Set([...document.querySelectorAll("button[aria-label], [role=button][aria-label]")]
      .map((e) => e.getAttribute("aria-label")))].slice(0, 60);
    const info = {
      detected,
      audioEls: document.querySelectorAll("audio").length,
      sliders: document.querySelectorAll('[role="slider"], input[type="range"]').length,
      dataIdRows: document.querySelectorAll("[data-id]").length,
      icons,
      labels,
    };
    const text = JSON.stringify(info, null, 1);
    try { await navigator.clipboard.writeText(text); badge.textContent = "Whisper: diagnóstico copiado ✔"; }
    catch { console.log("[WW diagnóstico]", text); badge.textContent = "Whisper: veja o console (F12)"; }
    console.log("[WW diagnóstico]", info);
  });

  let timer = null;
  const scan = () => {
    timer = null;
    document.querySelectorAll(ICON_SELECTOR).forEach(inject);
    detected = document.querySelectorAll(".ww-box").length;
    badge.textContent = `Whisper ativo · ${detected} áudio(s)`;
  };
  new MutationObserver(() => { if (!timer) timer = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (!timer) scan(); }, 2000); // rede de segurança
  scan();
})();
