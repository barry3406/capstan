import type { FingerprintProfile } from './fingerprint.js';

/**
 * 生成 JS 反检测脚本 — 注入到每个 BrowserContext 的 addInitScript
 *
 * 覆盖：navigator.webdriver、navigator.languages、screen 属性、
 *       Canvas 噪声（xorshift128 全像素 + toDataURL + toBlob）、
 *       WebGL 完整伪装（vendor/renderer/version/extensions）、
 *       AudioContext 完整指纹（AnalyserNode/OfflineAudioContext/sampleRate/baseLatency）
 *
 * 反检测注意事项：
 *   - 所有 prototype hook 都用 native toString 伪装
 *   - navigator.webdriver 用 defineProperty（真实 Firefox webdriver === false 且属性存在）
 *   - Canvas 噪声基于 xorshift128 PRNG，按 canvas 尺寸确定性注入
 *   - WebGL hook 覆盖 getParameter + getSupportedExtensions
 *   - addInitScript 在所有 frame（含 iframe）中执行
 */
export function buildStealthScript(fp: FingerprintProfile): string {
  return `(() => {
  // ─── 工具：伪装函数的 toString 为 native code ───
  const nativeToString = Function.prototype.toString;
  const fakeNative = new Map();
  Function.prototype.toString = function() {
    const fake = fakeNative.get(this);
    if (fake) return fake;
    return nativeToString.call(this);
  };
  fakeNative.set(Function.prototype.toString, 'function toString() { [native code] }');

  function maskAsNative(fn, name) {
    fakeNative.set(fn, 'function ' + name + '() { [native code] }');
  }

  // ─── navigator.webdriver ───
  // 用 defineProperty 而非 delete — 真实 Firefox webdriver === false 且属性存在
  Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
    get: () => false,
    configurable: true,
    enumerable: true,
  });

  // ─── navigator.languages（缓存引用，保证 === 一致性） ───
  const frozenLangs = Object.freeze([${JSON.stringify(fp.locale)}, 'en-US', 'en']);
  Object.defineProperty(Object.getPrototypeOf(navigator), 'languages', {
    get: () => frozenLangs,
    configurable: true,
    enumerable: true,
  });

  // ─── navigator.language ───
  Object.defineProperty(Object.getPrototypeOf(navigator), 'language', {
    get: () => ${JSON.stringify(fp.locale)},
    configurable: true,
    enumerable: true,
  });

  // ─── screen 属性（桌面模式：viewport + taskbar 偏移） ───
  const screenProps = {
    width: ${fp.screen.width},
    height: ${fp.screen.height},
    availWidth: ${fp.screen.width},
    availHeight: ${fp.screen.availHeight},
    colorDepth: 24,
    pixelDepth: 24,
  };
  for (const [key, val] of Object.entries(screenProps)) {
    try {
      Object.defineProperty(Screen.prototype, key, {
        get: () => val,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  }

  // ─── 时区 ───
  const TARGET_TZ = ${JSON.stringify(fp.timezone)};
  const OrigDateTimeFormat = Intl.DateTimeFormat;
  // 用 Proxy 而非替换函数 — 保持 new 和 instanceof 行为
  Intl.DateTimeFormat = new Proxy(OrigDateTimeFormat, {
    construct(target, args) {
      if (!args[1]?.timeZone) {
        const opts = Object.assign({}, args[1] || {}, { timeZone: TARGET_TZ });
        return new target(args[0], opts);
      }
      return new target(...args);
    },
    apply(target, thisArg, args) {
      if (!args[1]?.timeZone) {
        const opts = Object.assign({}, args[1] || {}, { timeZone: TARGET_TZ });
        return target(args[0], opts);
      }
      return target(...args);
    },
  });

  // Date.prototype.getTimezoneOffset — 返回与 UTC 的分钟差
  const TZ_OFFSETS = { 'Asia/Shanghai': -480, 'Asia/Chongqing': -480, 'Asia/Taipei': -480, 'Asia/Hong_Kong': -480 };
  const targetOffset = TZ_OFFSETS[TARGET_TZ] ?? -480;
  const hookedGetTimezoneOffset = function() { return targetOffset; };
  Date.prototype.getTimezoneOffset = hookedGetTimezoneOffset;
  maskAsNative(hookedGetTimezoneOffset, 'getTimezoneOffset');

  // ─── Canvas fingerprint 噪声（xorshift128 全像素） ───
  const NOISE_SEED = ${fp.canvasNoise};
  function xorshift128(state) {
    let t = state[3];
    t ^= t << 11; t ^= t >>> 8;
    state[3] = state[2]; state[2] = state[1]; state[1] = state[0];
    t ^= state[0]; t ^= state[0] >>> 19;
    state[0] = t;
    return (t >>> 0) / 4294967296;
  }

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  const hookedGetImageData = function(...args) {
    const imageData = origGetImageData.apply(this, args);
    try {
      const sizeFactor = (this.canvas.width * 31 + this.canvas.height) & 0xFFFF;
      const s = NOISE_SEED ^ sizeFactor;
      const state = [s * 1337, s * 7919 + 1, s * 104729 + 2, s * 15485863 + 3];
      for (let w = 0; w < 20; w++) xorshift128(state);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = xorshift128(state);
        if (r < 0.5) {
          d[i]     = Math.min(255, Math.max(0, d[i]     + (r < 0.25 ? 1 : -1)));
          d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + (xorshift128(state) < 0.5 ? 1 : -1)));
          d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + (xorshift128(state) < 0.5 ? 1 : -1)));
        }
      }
    } catch {}
    return imageData;
  };
  CanvasRenderingContext2D.prototype.getImageData = hookedGetImageData;
  maskAsNative(hookedGetImageData, 'getImageData');

  // toDataURL hook — 通过 getImageData 间接注入噪声
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const hookedToDataURL = function(...args) {
    try {
      const ctx = this.getContext('2d');
      if (ctx) { const img = ctx.getImageData(0, 0, this.width, this.height); ctx.putImageData(img, 0, 0); }
    } catch {}
    return origToDataURL.apply(this, args);
  };
  HTMLCanvasElement.prototype.toDataURL = hookedToDataURL;
  maskAsNative(hookedToDataURL, 'toDataURL');

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  const hookedToBlob = function(callback, ...args) {
    try {
      const ctx = this.getContext('2d');
      if (ctx) { const img = ctx.getImageData(0, 0, this.width, this.height); ctx.putImageData(img, 0, 0); }
    } catch {}
    return origToBlob.call(this, callback, ...args);
  };
  HTMLCanvasElement.prototype.toBlob = hookedToBlob;
  maskAsNative(hookedToBlob, 'toBlob');

  // ─── WebGL 完整伪装 ───
  const VENDOR = ${JSON.stringify(fp.webglVendor)};
  const RENDERER = ${JSON.stringify(fp.webglRenderer)};
  const UNMASKED_VENDOR = 0x9245;
  const UNMASKED_RENDERER = 0x9246;
  const WEBGL_VERSION = ${JSON.stringify(fp.webglVersion)};
  const WEBGL_SHADING_VERSION = ${JSON.stringify(fp.webglShadingVersion)};
  const WEBGL_MAX_TEXTURE = ${fp.webglMaxTextureSize};
  const WEBGL_MAX_RENDERBUFFER = ${fp.webglMaxRenderbufferSize};
  const WEBGL_MAX_VIEWPORT = [${fp.webglMaxViewportDims[0]}, ${fp.webglMaxViewportDims[1]}];
  const WEBGL_EXTENSIONS = ${JSON.stringify(fp.webglExtensions)};

  function patchGetParameter(proto) {
    const orig = proto.getParameter;
    const hooked = function(param) {
      if (param === UNMASKED_VENDOR || param === UNMASKED_RENDERER) {
        const ext = this.getExtension('WEBGL_debug_renderer_info');
        if (ext) return param === UNMASKED_VENDOR ? VENDOR : RENDERER;
      }
      if (param === 0x1F02) return WEBGL_VERSION;
      if (param === 0x8B8C) return WEBGL_SHADING_VERSION;
      if (param === 0x0D33) return WEBGL_MAX_TEXTURE;
      if (param === 0x84E8) return WEBGL_MAX_RENDERBUFFER;
      if (param === 0x0D3A) return new Int32Array(WEBGL_MAX_VIEWPORT);
      return orig.call(this, param);
    };
    proto.getParameter = hooked;
    maskAsNative(hooked, 'getParameter');
  }
  patchGetParameter(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchGetParameter(WebGL2RenderingContext.prototype);
  }

  function patchGetExtensions(proto) {
    const orig = proto.getSupportedExtensions;
    const hooked = function() { return WEBGL_EXTENSIONS.slice(); };
    proto.getSupportedExtensions = hooked;
    maskAsNative(hooked, 'getSupportedExtensions');
  }
  patchGetExtensions(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchGetExtensions(WebGL2RenderingContext.prototype);
  }

  // ─── AudioContext 完整指纹伪装 ───
  const AUDIO_SAMPLE_RATE = ${fp.audioSampleRate};
  const AUDIO_MAX_CHANNELS = ${fp.audioMaxChannelCount};
  const AUDIO_BASE_LATENCY = ${fp.audioBaseLatency};

  if (typeof AnalyserNode !== 'undefined') {
    const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
    const hookedGetFloat = function(array) {
      origGetFloat.call(this, array);
      const aState = [NOISE_SEED * 1337, NOISE_SEED * 7919 + 1, NOISE_SEED * 104729 + 2, NOISE_SEED * 15485863 + 3];
      for (let w = 0; w < 10; w++) xorshift128(aState);
      for (let i = 0; i < array.length; i++) {
        array[i] += (xorshift128(aState) - 0.5) * 0.0002;
      }
    };
    AnalyserNode.prototype.getFloatFrequencyData = hookedGetFloat;
    maskAsNative(hookedGetFloat, 'getFloatFrequencyData');

    const origGetByte = AnalyserNode.prototype.getByteFrequencyData;
    const hookedGetByte = function(array) {
      origGetByte.call(this, array);
      const aState = [NOISE_SEED * 2221, NOISE_SEED * 8291 + 1, NOISE_SEED * 112139 + 2, NOISE_SEED * 16777259 + 3];
      for (let w = 0; w < 10; w++) xorshift128(aState);
      for (let i = 0; i < Math.min(array.length, 32); i++) {
        array[i] = Math.min(255, Math.max(0, array[i] + Math.round((xorshift128(aState) - 0.5) * 2)));
      }
    };
    AnalyserNode.prototype.getByteFrequencyData = hookedGetByte;
    maskAsNative(hookedGetByte, 'getByteFrequencyData');

    const origGetFloatTime = AnalyserNode.prototype.getFloatTimeDomainData;
    const hookedGetFloatTime = function(array) {
      origGetFloatTime.call(this, array);
      const aState = [NOISE_SEED * 3571, NOISE_SEED * 9241 + 1, NOISE_SEED * 127031 + 2, NOISE_SEED * 19999999 + 3];
      for (let w = 0; w < 10; w++) xorshift128(aState);
      for (let i = 0; i < array.length; i++) {
        array[i] += (xorshift128(aState) - 0.5) * 0.0002;
      }
    };
    AnalyserNode.prototype.getFloatTimeDomainData = hookedGetFloatTime;
    maskAsNative(hookedGetFloatTime, 'getFloatTimeDomainData');

    const origGetByteTime = AnalyserNode.prototype.getByteTimeDomainData;
    const hookedGetByteTime = function(array) {
      origGetByteTime.call(this, array);
      const aState = [NOISE_SEED * 4813, NOISE_SEED * 10337 + 1, NOISE_SEED * 141241 + 2, NOISE_SEED * 22801763 + 3];
      for (let w = 0; w < 10; w++) xorshift128(aState);
      for (let i = 0; i < Math.min(array.length, 32); i++) {
        array[i] = Math.min(255, Math.max(0, array[i] + Math.round((xorshift128(aState) - 0.5) * 2)));
      }
    };
    AnalyserNode.prototype.getByteTimeDomainData = hookedGetByteTime;
    maskAsNative(hookedGetByteTime, 'getByteTimeDomainData');
  }

  if (typeof OfflineAudioContext !== 'undefined') {
    function applyAudioNoise(buffer) {
      try {
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const channel = buffer.getChannelData(ch);
          const aState = [NOISE_SEED * 2131 + ch, NOISE_SEED * 6271 + 1, NOISE_SEED * 91813 + 2, NOISE_SEED * 12491 + 3];
          for (let w = 0; w < 10; w++) xorshift128(aState);
          for (let i = 0; i < channel.length; i++) {
            channel[i] += (xorshift128(aState) - 0.5) * 0.00000002;
          }
        }
      } catch {}
    }
    const origStartRendering = OfflineAudioContext.prototype.startRendering;
    const hookedStartRendering = function() {
      return origStartRendering.call(this).then(function(buffer) { applyAudioNoise(buffer); return buffer; });
    };
    OfflineAudioContext.prototype.startRendering = hookedStartRendering;
    maskAsNative(hookedStartRendering, 'startRendering');
  }

  if (typeof AudioContext !== 'undefined') {
    Object.defineProperty(AudioContext.prototype, 'sampleRate', {
      get: () => AUDIO_SAMPLE_RATE, configurable: true, enumerable: true,
    });
    if ('baseLatency' in AudioContext.prototype) {
      Object.defineProperty(AudioContext.prototype, 'baseLatency', {
        get: () => AUDIO_BASE_LATENCY, configurable: true, enumerable: true,
      });
    }
  }
  if (typeof AudioDestinationNode !== 'undefined') {
    Object.defineProperty(AudioDestinationNode.prototype, 'maxChannelCount', {
      get: () => AUDIO_MAX_CHANNELS, configurable: true, enumerable: true,
    });
  }

  // ─── window.outerWidth/outerHeight（模拟窗口边框） ───
  // 真实浏览器 outer 比 inner 大（有标题栏/工具栏），headless 二者相等是自动化特征
  const CHROME_HEIGHT = ${fp.chromeHeight};  // 标题栏+工具栏高度
  const CHROME_WIDTH = ${fp.chromeBorder};   // 左右边框（通常很小）
  Object.defineProperty(window, 'outerHeight', {
    get: () => window.innerHeight + CHROME_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(window, 'outerWidth', {
    get: () => window.innerWidth + CHROME_WIDTH,
    configurable: true,
  });

  // ─── Error.stack 清洗（移除 Playwright evaluate 注入痕迹） ───
  // Firefox: stack 是 Error 实例的 own property（不是 prototype getter）
  // 用 Proxy 拦截 Error 构造来清洗 stack
  function cleanStack(stack) {
    if (typeof stack !== 'string') return stack;
    return stack.split('\\n').filter(function(line) {
      return !line.includes('__playwright') &&
             !line.includes('evaluate@') &&
             !line.includes('evaluateHandle@') &&
             !line.includes('Runtime.evaluate');
    }).join('\\n');
  }
  // 方案 1：如果 prototype 上有 getter（V8 引擎），hook getter
  const stackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
  if (stackDesc && stackDesc.get) {
    const origGetter = stackDesc.get;
    Object.defineProperty(Error.prototype, 'stack', {
      get: function() { return cleanStack(origGetter.call(this)); },
      set: stackDesc.set,
      configurable: true,
    });
  } else {
    // 方案 2：Firefox — stack 是 own property，在 Error 构造后拦截
    // 使用 MutationObserver + Proxy 无法拦截，改用定义 prototype setter/getter
    Object.defineProperty(Error.prototype, 'stack', {
      get: function() { return cleanStack(this.__rawStack); },
      set: function(v) { this.__rawStack = v; },
      configurable: true,
      enumerable: false,
    });
  }
})();`;
}
