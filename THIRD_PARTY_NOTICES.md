# Third-party software

The `lib/` folder bundles unmodified builds of:

| File(s) | Project | License |
|---|---|---|
| `transformers.min.js` | [Transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | Apache-2.0 |
| `ort-wasm-simd-threaded*.mjs`, `ort-wasm-simd-threaded*.wasm` | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | MIT |

Whisper models are downloaded at runtime from the Hugging Face Hub
(`Xenova/whisper-*`, `onnx-community/whisper-large-v3-turbo`); OpenAI Whisper weights are MIT-licensed.
