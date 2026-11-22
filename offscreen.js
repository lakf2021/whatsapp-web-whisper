import { pipeline, env } from "./lib/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm ??= {};
// No Windows a escolha da GPU é feita pelo sistema (Configurações → Gráficos), não pelo Chrome.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
// multithread só funciona com crossOriginIsolated (COOP/COEP no manifest)
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  : 1;

let pipe = null;
let pipeKey = null;
let pipeDevice = null;
let loading = null;

function sendProgress(p) {
  chrome.runtime.sendMessage({ type: "progress", ...p }).catch(() => {});
}

async function webgpuInfo() {
  try {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const info = adapter.info || {};
    console.log("[WW] GPU:", info.vendor, info.architecture, info.description);
    return { f16: adapter.features.has("shader-f16") };
  } catch {
    return null;
  }
}

function makePipe(model, device, dtype) {
  const files = {};
  return pipeline("automatic-speech-recognition", model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        let l = 0, t = 0;
        for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
        sendProgress({ phase: "download", pct: Math.round((100 * l) / t), device });
      }
    },
  });
}

async function load(model, devicePref) {
  const gpu = devicePref === "wasm" ? null : await webgpuInfo();
  if (gpu) {
    try {
      const dtype = { encoder_model: gpu.f16 ? "fp16" : "q4", decoder_model_merged: "q4" };
      const p = await makePipe(model, "webgpu", dtype);
      pipeDevice = "webgpu";
      return p;
    } catch (e) {
      console.warn("WebGPU falhou, usando WASM:", e);
    }
  }
  pipeDevice = "wasm";
  return makePipe(model, "wasm", "q8");
}

async function getPipe(model, devicePref) {
  const key = model + "|" + devicePref;
  if (pipe && pipeKey === key) return pipe;
  if (loading && pipeKey === key) return loading;
  if (pipe) { try { await pipe.dispose(); } catch {} pipe = null; }
  pipeKey = key;
  loading = load(model, devicePref)
    .then((p) => { pipe = p; loading = null; return p; })
    .catch((e) => { loading = null; pipeKey = null; throw e; });
  return loading;
}

async function decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen" || msg.type !== "transcribe") return;
  (async () => {
    try {
      const audio = await decode(msg.b64);
      sendProgress({ phase: "load" });
      const p = await getPipe(msg.model, msg.device || "auto");
      sendProgress({ phase: "transcribe", device: pipeDevice });
      const opts = { chunk_length_s: 30, stride_length_s: 5, task: "transcribe" };
      if (msg.language) opts.language = msg.language;
      const out = await p(audio, opts);
      sendResponse({ text: (out.text || "").trim(), device: pipeDevice });
    } catch (e) {
      sendResponse({ error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});
