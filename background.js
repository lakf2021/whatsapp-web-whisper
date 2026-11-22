// Service worker: cria o documento offscreen (onde o Whisper roda) e faz a ponte.
let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Rodar o modelo Whisper (WASM) para transcrever áudios",
      })
      .finally(() => (creating = null));
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return; // mensagem para o offscreen

  if (msg.type === "transcribe") {
    const tabId = sender.tab && sender.tab.id;
    (async () => {
      try {
        await ensureOffscreen();
        const settings = await chrome.storage.sync.get({ model: "Xenova/whisper-base", language: "portuguese", device: "auto" });
        const payload = {
          target: "offscreen",
          type: "transcribe",
          b64: msg.b64,
          model: settings.model,
          device: settings.device,
          language: settings.language === "auto" ? null : settings.language,
        };
        // o offscreen pode ainda estar inicializando: tenta algumas vezes
        let res, lastErr;
        for (let i = 0; i < 20; i++) {
          try { res = await chrome.runtime.sendMessage(payload); lastErr = null; break; }
          catch (e) {
            lastErr = e;
            if (!/Receiving end does not exist/i.test(String(e && e.message))) break;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        if (lastErr) throw new Error("Whisper não iniciou (veja erros em offscreen.html): " + lastErr.message);
        sendResponse(res);
      } catch (e) {
        sendResponse({ error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "progress" && sender.url && sender.url.endsWith("offscreen.html")) {
    // repassa progresso para todas as abas do WhatsApp
    chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
      for (const t of tabs) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
    });
  }
});
