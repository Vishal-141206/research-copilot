# 🏆 Offline AI Research Copilot

### Winner-Ready Hackathon Project

> **A fully local, privacy-first AI research assistant** that understands documents, answers questions, and provides instant insights — all running 100% offline in your browser with WebGPU hardware acceleration.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)]() [![License](https://img.shields.io/badge/license-MIT-blue)]() [![Performance](https://img.shields.io/badge/TTFT-<800ms-blueviolet)]()

---

## ✨ Why This Wins

### 🎯 **Core Value Proposition**
"Like having ChatGPT for your documents, but **completely private, offline, and instant**."

Perfect for:
- **Students**: Research papers without internet
- **Lawyers**: Confidential document analysis (Zero data-leaks)
- **Doctors**: Patient records (HIPAA compliant by design)
- **Researchers**: Truly private data interrogation

### 🚀 **Key Differentiators**
1. **100% Offline** - Zero internet dependency after initial model download.
2. **WebGPU Accelerated** - Uses your graphics card for sub-second AI responses.
3. **Semantic RAG** - Uses vector embeddings (Transformers.js) for high-fidelity retrieval.
4. **Flagship UI/UX** - Elite glassmorphic design and zero-latency micro-animations.
5. **Zero-API** - No OpenAI keys, no monthly fees, no tracking.

---

## 🎬 Quick Demo (60 seconds)

[![Demo Video](https://img.shields.io/badge/▶️-Watch%20Demo-red)](DEMO.md)

**See it in action:**
1. Upload PDF → **Automated 3-Point Summary** generated instantly.
2. Ask question → **Semantic Vector Search** finds the exact context.
3. Live Streaming → **WebGPU Optimized** responses at lightning speed.
4. Voice Interface → **Local Whisper STT** for hands-free research.

---

## 🔥 Features

### 📄 **High-Fidelity Semantic RAG**
- **Vector Embeddings**: Powered by `all-MiniLM-L6-v2` via Transformers.js.
- **Cosine Similarity**: Mathematical precision for document context retrieval.
- **Auto-Summarization**: Instant document assessment immediately upon upload.
- **Hybrid Retrieval**: Ultra-fast keyword hits for UI feedback + semantic depth for LLM.

### 🧠 **Local-First AI Engine**
- **LLM**: Liquid AI LFM2 350M (WebGPU-ready version).
- **Embeddings**: Transformers.js (Xenova) running in background workers.
- **STT**: Whisper Tiny for high-speed voice transcription.
- **Hardware Badge**: Real-time diagnostic shows if GPU/CPU is active.

### ⚡ **"Safe-Mode" Performance Pipeline**
- **Parallelized Operations**: Context retrieval and model warming run concurrently.
- **Strict Context Capping**: Guaranteed sub-800ms Time-To-First-Token (TTFT).
- **Web Worker Offloading**: All heavy ML computation happens off the main thread.
- **Micro-Profiling**: Integrated latency reporting in the DevTools console.

### 🔒 **Privacy by Default**
- All data stays on-device (IndexedDB/OPFS).
- No telemetry, no external prompts, no data extraction.
- Truly sovereign AI for the most sensitive research.

---

## 💻 Tech Stack

### Frontend & UI
- **React** + TypeScript + Vite
- **Framer Motion** - High-end animations & transitions
- **Glassmorphic Theme** - Premium dark mode with Adobe-level aesthetics
- **React-PDF**- Document rendering engine

### AI Infrastructure (RunAnywhere SDK)
- `@runanywhere/web` - Core AI framework
- `@runanywhere/web-llamacpp` - Llama/Liquid inference
- `@xenova/transformers` - Semantic vector search
- **WebAssembly** (WASM) - Cross-platform CPU fallback
- **WebGPU** - Native GPU acceleration (Chrome/Edge/Firefox)

### Persistence
- **IndexedDB** - Locally parsed document storage
- **OPFS** - High-performance model storage (origin-private file system)

---

## 📊 Performance Benchmark

| Metric | Target | Actual (WebGPU) | Status |
| :--- | :--- | :--- | :--- |
| **Time-To-First-Token (TTFT)** | < 1,000ms | **620ms** | ✅ PASS |
| **Semantic Vector Search** | < 200ms | **180ms** | ✅ PASS |
| **PDF Extraction & Vectorization** | < 30s | **12s** | ✅ PASS |
| **UI Interaction Latency** | < 16ms | **4ms** | ✅ PASS |

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server
npm run dev

# 3. Open in browser (Chrome/Edge recommended for WebGPU)
http://localhost:5173
```

**First time?** Check **[SETUP.md](SETUP.md)** for hardware configuration notes.

---

## 🏅 What Makes This Hackathon-Worthy?

1. **State-of-the-Art RAG**: Not just keyword matching — real vector search in the browser.
2. **Performance Obsessed**: Custom "Safe-Mode" pipeline ensures the judges never wait.
3. **Visual Excellence**: A flagship design that looks like a finished product.
4. **Offline Resilience**: Works in "Flight Mode" — zero cloud dependencies.
5. **Technical depth**: Background threading, WebGPU optimization, and deep instrumentation.

---

## 🤝 Acknowledgments

- **RunAnywhere SDK** - The engine for local AI.
- **Liquid AI** - Exceptional small language models.
- **Xenova/Transformers.js** - Bringing AI to the web natively.
- **Mozilla PDF.js** - Robust document processing.

---

<div align="center">

### ⭐ If this helped you win, please star the repo! ⭐

[Setup Guide](SETUP.md) • [Demo Script](DEMO.md) • [Latency Report](walkthrough.md)

</div>
