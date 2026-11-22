const defaults = { model: "Xenova/whisper-base", language: "portuguese", device: "auto" };
const ids = ["model", "language", "device"];
chrome.storage.sync.get(defaults).then((s) => {
  for (const id of ids) {
    const el = document.getElementById(id);
    el.value = s[id];
    el.addEventListener("change", () => chrome.storage.sync.set({ [id]: el.value }));
  }
});
