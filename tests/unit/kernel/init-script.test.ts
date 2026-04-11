import { describe, test, expect } from 'bun:test';
import { buildStealthScript } from '../../../packages/ai/dist/harness/kernel/stealth/init-script.js';
import type { FingerprintProfile } from '../../../packages/ai/dist/harness/kernel/stealth/fingerprint.js';

const MOCK_FP: FingerprintProfile = {
  os: 'windows',
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 430, height: 932 },
  screen: { width: 1920, height: 1120, availHeight: 1080 },
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  fonts: ['Microsoft YaHei', 'SimHei', 'Arial', 'Helvetica'],
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)',
  canvasNoise: 42,
  chromeHeight: 85,
  chromeBorder: 0,
  webglVersion: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
  webglShadingVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
  webglMaxTextureSize: 32768,
  webglMaxRenderbufferSize: 32768,
  webglMaxViewportDims: [32768, 32768],
  webglExtensions: ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'WEBGL_debug_renderer_info', 'WEBGL_lose_context'],
  audioSampleRate: 48000,
  audioMaxChannelCount: 2,
  audioBaseLatency: 0.01,
};

describe('buildStealthScript', () => {
  test('returns IIFE-formatted JS string', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(typeof script).toBe('string');
    expect(script).toMatch(/^\(\(\) => \{/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  test('uses defineProperty to disguise navigator.webdriver as false', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('webdriver');
    expect(script).toContain('defineProperty');
    expect(script).toContain('get: () => false');
  });

  test('injects toString disguise (native code masking)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('[native code]');
    expect(script).toContain('maskAsNative');
  });

  test('injects fingerprint locale into navigator.languages', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('"zh-CN"');
    expect(script).toContain('languages');
  });

  test('screen properties defined on Screen.prototype (iframe-safe)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('Screen.prototype');
    expect(script).toContain('1920');
    expect(script).toContain('1120');
  });

  test('Canvas noise uses xorshift128 and hooks getImageData/toDataURL/toBlob', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('getImageData');
    expect(script).toContain('xorshift128');
    expect(script).toContain('origToDataURL');
    expect(script).toContain('origToBlob');
    expect(script).toContain('hookedToDataURL');
    expect(script).toContain('hookedToBlob');
  });

  test('WebGL full disguise (vendor/renderer/version/extensions)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('WEBGL_debug_renderer_info');
    expect(script).toContain('getExtension');
    expect(script).toContain('NVIDIA');
    expect(script).toContain('WEBGL_VERSION');
    expect(script).toContain('WEBGL_SHADING_VERSION');
    expect(script).toContain('WEBGL_MAX_TEXTURE');
    expect(script).toContain('32768');
    expect(script).toContain('getSupportedExtensions');
    expect(script).toContain('WEBGL_EXTENSIONS');
  });

  test('does not inject Chrome-style navigator.plugins', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).not.toContain('PDF Viewer');
    expect(script).not.toContain('PluginArray');
  });

  test('navigator.languages cached reference (=== consistency)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('frozenLangs');
    // Only one frozen array defined, getter returns same reference
    expect(script).toMatch(/const frozenLangs.*Object\.freeze/);
  });

  test('injects navigator.language (singular form)', () => {
    const script = buildStealthScript(MOCK_FP);
    // Should cover both languages and language
    const langCount = (script.match(/navigator.*language/g) || []).length;
    expect(langCount).toBeGreaterThanOrEqual(2);
  });

  test('injects timezone override (Intl.DateTimeFormat + getTimezoneOffset)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('Asia/Shanghai');
    expect(script).toContain('DateTimeFormat');
    expect(script).toContain('getTimezoneOffset');
    expect(script).toContain('-480');
  });

  test('AudioContext full fingerprint disguise (AnalyserNode 4 methods + OfflineAudioContext + sampleRate/baseLatency)', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('AnalyserNode');
    expect(script).toContain('getFloatFrequencyData');
    expect(script).toContain('getByteFrequencyData');
    expect(script).toContain('getFloatTimeDomainData');
    expect(script).toContain('getByteTimeDomainData');
    expect(script).toContain('OfflineAudioContext');
    expect(script).toContain('startRendering');
    expect(script).toContain('AUDIO_SAMPLE_RATE');
    expect(script).toContain('48000');
    expect(script).toContain('AUDIO_BASE_LATENCY');
    expect(script).toContain('AUDIO_MAX_CHANNELS');
    expect(script).toContain('AudioDestinationNode');
  });

  test('outerWidth/outerHeight simulate window chrome', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('outerHeight');
    expect(script).toContain('outerWidth');
    expect(script).toContain('CHROME_HEIGHT');
    expect(script).toContain('85');  // fp.chromeHeight
  });

  test('Error.stack sanitizes Playwright traces', () => {
    const script = buildStealthScript(MOCK_FP);
    expect(script).toContain('__playwright');
    expect(script).toContain('Runtime.evaluate');
    expect(script).toContain('Error.prototype');
  });

  test('different fingerprints generate different scripts', () => {
    const fp2: FingerprintProfile = { ...MOCK_FP, locale: 'zh-TW', canvasNoise: 200 };
    const s1 = buildStealthScript(MOCK_FP);
    const s2 = buildStealthScript(fp2);
    expect(s1).not.toBe(s2);
    expect(s2).toContain('"zh-TW"');
    expect(s2).toContain('200');
  });
});
