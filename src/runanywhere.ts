import {
  RunAnywhere,
  SDKEnvironment,
  ModelCategory,
  LLMFramework,
  type CompactModelDef,
} from '@runanywhere/web';

const perfLog = (label: string, startTime?: number) => {
  if (startTime) {
    console.log(`[PERF] ${label}: ${Date.now() - startTime}ms`);
  } else {
    console.log(`[PERF] ${label}`);
  }
};

interface GPUAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
}

const LANGUAGE_MODELS: CompactModelDef[] = [
  {
    id: 'lfm2-350m-q4_k_m',
    name: 'LFM2 350M Q4_K_M',
    repo: 'LiquidAI/LFM2-350M-GGUF',
    files: ['LFM2-350M-Q4_K_M.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 250_000_000,
  },
];

const SPEECH_MODELS: CompactModelDef[] = [
  {
    id: 'sherpa-onnx-whisper-tiny.en',
    name: 'Whisper Tiny English (ONNX)',
    url: 'https://huggingface.co/runanywhere/sherpa-onnx-whisper-tiny.en/resolve/main/sherpa-onnx-whisper-tiny.en.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechRecognition,
    memoryRequirement: 105_000_000,
    artifactType: 'archive' as const,
  },
  {
    id: 'vits-piper-en_US-lessac-medium',
    name: 'Piper TTS US English (Lessac)',
    url: 'https://huggingface.co/runanywhere/vits-piper-en_US-lessac-medium/resolve/main/vits-piper-en_US-lessac-medium.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechSynthesis,
    memoryRequirement: 65_000_000,
    artifactType: 'archive' as const,
  },
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

let coreInitPromise: Promise<void> | null = null;
let llamaReadyPromise: Promise<void> | null = null;
let onnxReadyPromise: Promise<void> | null = null;
let llamaModulePromise: Promise<typeof import('@runanywhere/web-llamacpp')> | null = null;
let onnxModulePromise: Promise<typeof import('@runanywhere/web-onnx')> | null = null;
let webgpuSupported = false;
let accelerationMode: string | null = null;
let languageModelsRegistered = false;
let speechModelsRegistered = false;

function registerLanguageModels() {
  if (languageModelsRegistered) return;
  RunAnywhere.registerModels(LANGUAGE_MODELS);
  languageModelsRegistered = true;
}

function registerSpeechModels() {
  if (speechModelsRegistered) return;
  RunAnywhere.registerModels(SPEECH_MODELS);
  speechModelsRegistered = true;
}

function loadLlamaModule() {
  if (!llamaModulePromise) {
    llamaModulePromise = import('@runanywhere/web-llamacpp');
  }
  return llamaModulePromise;
}

function loadOnnxModule() {
  if (!onnxModulePromise) {
    onnxModulePromise = import('@runanywhere/web-onnx');
  }
  return onnxModulePromise;
}

export async function checkWebGPUSupport(): Promise<{ supported: boolean; info: GPUAdapterInfo | null }> {
  try {
    // @ts-ignore
    const gpu = navigator.gpu;
    if (!gpu) {
      return { supported: false, info: null };
    }

    // @ts-ignore
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { supported: false, info: null };
    }

    // @ts-ignore
    const info: GPUAdapterInfo = (await adapter.requestAdapterInfo?.()) || {};
    return { supported: true, info };
  } catch (error) {
    console.warn('[GPU] WebGPU check failed:', error);
    return { supported: false, info: null };
  }
}

export async function initSDK(): Promise<void> {
  if (coreInitPromise) return coreInitPromise;

  coreInitPromise = (async () => {
    const initStart = Date.now();
    perfLog('SDK core initialization started');

    const [gpuCheck] = await Promise.all([
      checkWebGPUSupport(),
      RunAnywhere.initialize({
        environment: SDKEnvironment.Production,
        debug: false,
      }),
    ]);

    webgpuSupported = gpuCheck.supported;
    registerLanguageModels();

    console.log('[RUNTIME] Core ready', {
      webgpuSupported,
      adapter: gpuCheck.info || 'unknown',
    });

    perfLog('SDK core initialized', initStart);
  })();

  return coreInitPromise;
}

export async function ensureLLMRuntime(): Promise<void> {
  if (llamaReadyPromise) return llamaReadyPromise;

  llamaReadyPromise = (async () => {
    await initSDK();

    const llamaStart = Date.now();
    const { LlamaCPP } = await loadLlamaModule();
    await LlamaCPP.register();
    accelerationMode = LlamaCPP.accelerationMode;

    console.log('[RUNTIME] LLM backend ready', {
      accelerationMode,
      webgpuSupported,
    });

    perfLog('LlamaCPP registered', llamaStart);
  })();

  return llamaReadyPromise;
}

export async function ensureSpeechRuntime(): Promise<void> {
  if (onnxReadyPromise) return onnxReadyPromise;

  onnxReadyPromise = (async () => {
    await initSDK();
    registerSpeechModels();

    const onnxStart = Date.now();
    const { ONNX } = await loadOnnxModule();
    await ONNX.register();
    perfLog('ONNX registered', onnxStart);
  })();

  return onnxReadyPromise;
}

export async function getTextGenerationApi() {
  await ensureLLMRuntime();
  const { TextGeneration } = await loadLlamaModule();
  return TextGeneration;
}

export async function getSTTApi() {
  await ensureSpeechRuntime();
  const { STT } = await loadOnnxModule();
  return STT;
}

export function primeSDK() {
  const startPrime = () => {
    initSDK().catch((error) => console.warn('[RUNTIME] Core warmup skipped:', error));
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => startPrime(), { timeout: 1500 });
  } else {
    setTimeout(startPrime, 300);
  }
}

export function getAccelerationMode(): string | null {
  return accelerationMode;
}

export function isUsingWebGPU(): boolean {
  return accelerationMode === 'webgpu';
}

export function isWebGPUSupported(): boolean {
  return webgpuSupported;
}
