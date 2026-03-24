/**
 * RunAnywhere SDK initialization and model catalog.
 *
 * OPTIMIZED FOR HACKATHON:
 * - Force WebGPU acceleration where available
 * - Performance logging for debugging
 * - Model warmup for consistent latency
 */

import {
  RunAnywhere,
  SDKEnvironment,
  ModelManager,
  ModelCategory,
  LLMFramework,
  type CompactModelDef,
} from '@runanywhere/web';

import { LlamaCPP, VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { ONNX } from '@runanywhere/web-onnx';

// Vite bundles the worker as a standalone JS chunk and returns its URL.
// @ts-ignore — Vite-specific ?worker&url query
import vlmWorkerUrl from './workers/vlm-worker?worker&url';

// ---------------------------------------------------------------------------
// Performance Logging
// ---------------------------------------------------------------------------

const perfLog = (label: string, startTime?: number) => {
  if (startTime) {
    console.log(`[PERF] ${label}: ${Date.now() - startTime}ms`);
  } else {
    console.log(`[PERF] ${label}`);
  }
};

// ---------------------------------------------------------------------------
// WebGPU Detection (with type safety)
// ---------------------------------------------------------------------------

interface GPUAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
}

export async function checkWebGPUSupport(): Promise<{ supported: boolean; info: GPUAdapterInfo | null }> {
  try {
    // @ts-ignore - WebGPU types not in standard lib
    const gpu = navigator.gpu;
    if (!gpu) {
      console.warn('[GPU] WebGPU not available in this browser');
      return { supported: false, info: null };
    }

    // @ts-ignore - WebGPU types
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      console.warn('[GPU] No WebGPU adapter found');
      return { supported: false, info: null };
    }

    // @ts-ignore - WebGPU types
    const info: GPUAdapterInfo = await adapter.requestAdapterInfo?.() || {};
    console.log('[GPU] WebGPU Adapter:', {
      vendor: info.vendor || 'unknown',
      architecture: info.architecture || 'unknown',
      device: info.device || 'unknown',
    });

    return { supported: true, info };
  } catch (e) {
    console.warn('[GPU] WebGPU check failed:', e);
    return { supported: false, info: null };
  }
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

const MODELS: CompactModelDef[] = [
  // LLM — Liquid AI LFM2 350M (small + fast for chat)
  {
    id: 'lfm2-350m-q4_k_m',
    name: 'LFM2 350M Q4_K_M',
    repo: 'LiquidAI/LFM2-350M-GGUF',
    files: ['LFM2-350M-Q4_K_M.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 250_000_000,
  },
  // LLM — Liquid AI LFM2 1.2B Tool (optimized for tool calling & function calling)
  {
    id: 'lfm2-1.2b-tool-q4_k_m',
    name: 'LFM2 1.2B Tool Q4_K_M',
    repo: 'LiquidAI/LFM2-1.2B-Tool-GGUF',
    files: ['LFM2-1.2B-Tool-Q4_K_M.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 800_000_000,
  },
  // VLM — Liquid AI LFM2-VL 450M (vision + language)
  {
    id: 'lfm2-vl-450m-q4_0',
    name: 'LFM2-VL 450M Q4_0',
    repo: 'runanywhere/LFM2-VL-450M-GGUF',
    files: ['LFM2-VL-450M-Q4_0.gguf', 'mmproj-LFM2-VL-450M-Q8_0.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Multimodal,
    memoryRequirement: 500_000_000,
  },
  // STT (sherpa-onnx archive)
  {
    id: 'sherpa-onnx-whisper-tiny.en',
    name: 'Whisper Tiny English (ONNX)',
    url: 'https://huggingface.co/runanywhere/sherpa-onnx-whisper-tiny.en/resolve/main/sherpa-onnx-whisper-tiny.en.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechRecognition,
    memoryRequirement: 105_000_000,
    artifactType: 'archive' as const,
  },
  // TTS (sherpa-onnx archive)
  {
    id: 'vits-piper-en_US-lessac-medium',
    name: 'Piper TTS US English (Lessac)',
    url: 'https://huggingface.co/runanywhere/vits-piper-en_US-lessac-medium/resolve/main/vits-piper-en_US-lessac-medium.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechSynthesis,
    memoryRequirement: 65_000_000,
    artifactType: 'archive' as const,
  },
  // VAD (single ONNX file)
  {
    id: 'silero-vad-v5',
    name: 'Silero VAD v5',
    url: 'https://huggingface.co/runanywhere/silero-vad-v5/resolve/main/silero_vad.onnx',
    files: ['silero_vad.onnx'],
    framework: LLMFramework.ONNX,
    modality: ModelCategory.Audio,
    memoryRequirement: 5_000_000,
  },
];

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | null = null;
let _webgpuSupported = false;
let _accelerationMode: string | null = null;

/** Initialize the RunAnywhere SDK. Safe to call multiple times. */
export async function initSDK(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const initStart = Date.now();
    perfLog('SDK initialization started');

    // Step 0: Check WebGPU support FIRST
    const gpuCheck = await checkWebGPUSupport();
    _webgpuSupported = gpuCheck.supported;
    perfLog(`WebGPU check complete (supported: ${_webgpuSupported})`, initStart);

    // Step 1: Initialize core SDK (TypeScript-only, no WASM)
    const coreStart = Date.now();
    await RunAnywhere.initialize({
      environment: SDKEnvironment.Development,
      debug: true,
    });
    perfLog('Core SDK initialized', coreStart);

    // Step 2: Register backends (loads WASM automatically)
    const llamaStart = Date.now();
    await LlamaCPP.register();
    _accelerationMode = LlamaCPP.accelerationMode;
    perfLog(`LlamaCPP registered (mode: ${_accelerationMode})`, llamaStart);

    // Log acceleration mode prominently
    console.log('========================================');
    console.log(`[RUNTIME] Acceleration Mode: ${_accelerationMode}`);
    console.log(`[RUNTIME] WebGPU Available: ${_webgpuSupported}`);
    if (_accelerationMode === 'webgpu') {
      console.log('[RUNTIME] ✅ Using WebGPU - FAST mode');
    } else if (_accelerationMode === 'simd') {
      console.log('[RUNTIME] ⚠️ Using SIMD CPU - Moderate speed');
    } else {
      console.log('[RUNTIME] ❌ Using basic CPU - SLOW mode');
    }
    console.log('========================================');

    const onnxStart = Date.now();
    await ONNX.register();
    perfLog('ONNX registered', onnxStart);

    // Step 3: Register model catalog
    RunAnywhere.registerModels(MODELS);
    perfLog('Models registered');

    // Step 4: Wire up VLM worker
    VLMWorkerBridge.shared.workerUrl = vlmWorkerUrl;
    RunAnywhere.setVLMLoader({
      get isInitialized() { return VLMWorkerBridge.shared.isInitialized; },
      init: () => VLMWorkerBridge.shared.init(),
      loadModel: (params) => VLMWorkerBridge.shared.loadModel(params),
      unloadModel: () => VLMWorkerBridge.shared.unloadModel(),
    });

    perfLog('SDK initialization complete', initStart);
  })();

  return _initPromise;
}

/** Get acceleration mode after init. */
export function getAccelerationMode(): string | null {
  return _accelerationMode;
}

/** Check if WebGPU is being used */
export function isUsingWebGPU(): boolean {
  return _accelerationMode === 'webgpu';
}

/** Check if WebGPU is supported */
export function isWebGPUSupported(): boolean {
  return _webgpuSupported;
}

// Re-export for convenience
export { RunAnywhere, ModelManager, ModelCategory, VLMWorkerBridge };
