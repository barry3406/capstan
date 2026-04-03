import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── 类型 ───

export type FingerprintOS = 'macos' | 'windows' | 'linux';

export interface FingerprintProfile {
  os: FingerprintOS;
  desktop: { width: number; height: number };
  mobile: { width: number; height: number };
  screen: { width: number; height: number; availHeight: number };
  locale: string;
  timezone: string;
  fonts: string[];
  webglVendor: string;
  webglRenderer: string;
  canvasNoise: number;
  /** 浏览器窗口 chrome 高度（标题栏+工具栏，outerHeight - innerHeight） */
  chromeHeight: number;
  /** 浏览器窗口边框宽度（outerWidth - innerWidth） */
  chromeBorder: number;
  // WebGL extended params
  webglVersion: string;
  webglShadingVersion: string;
  webglMaxTextureSize: number;
  webglMaxRenderbufferSize: number;
  webglMaxViewportDims: [number, number];
  webglExtensions: string[];
  // Audio
  audioSampleRate: number;
  audioMaxChannelCount: number;
  audioBaseLatency: number;
}

// ─── 池定义 ───

const OS_POOL: { value: FingerprintOS; weight: number }[] = [
  { value: 'windows', weight: 50 },
  { value: 'macos', weight: 40 },
  { value: 'linux', weight: 10 },
];

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
];

const MOBILE_VIEWPORTS = [
  { width: 430, height: 932 },  // iPhone 14 Pro Max
  { width: 393, height: 852 },  // iPhone 15
  { width: 412, height: 915 },  // Pixel 7
  { width: 360, height: 800 },  // Samsung S23
  { width: 390, height: 844 },  // iPhone 13
];

// locale 和 timezone 联动 — 避免 zh-TW + Asia/Shanghai 等不自然组合
const LOCALE_TIMEZONE_PAIRS: { locale: string; timezones: string[]; weight: number }[] = [
  { locale: 'zh-CN', timezones: ['Asia/Shanghai', 'Asia/Chongqing'], weight: 80 },
  { locale: 'zh-TW', timezones: ['Asia/Taipei'], weight: 10 },
  { locale: 'zh-HK', timezones: ['Asia/Hong_Kong'], weight: 10 },
];

// ─── 按 OS 分组的字体和 WebGL ───

const FONTS_BY_OS: Record<FingerprintOS, { chinese: string[]; latin: string[] }> = {
  macos: {
    chinese: ['PingFang SC', 'STHeiti', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC'],
    latin: ['Arial', 'Helvetica', 'Times New Roman'],
  },
  windows: {
    chinese: ['Microsoft YaHei', 'SimHei', 'SimSun', 'NSimSun', 'Noto Sans CJK SC'],
    latin: ['Arial', 'Helvetica', 'Times New Roman'],
  },
  linux: {
    chinese: ['Noto Sans CJK SC', 'WenQuanYi Micro Hei', 'Source Han Sans SC', 'Droid Sans Fallback'],
    latin: ['Arial', 'Helvetica', 'Times New Roman'],
  },
};

interface WebGLEntry {
  vendor: string;
  renderer: string;
  version: string;
  shadingVersion: string;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxViewportDims: [number, number];
  extensions: string[];
}

// macOS (Apple GPU) — 不走 ANGLE，无 ANGLE_instanced_arrays
const MACOS_EXTENSIONS = [
  'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_float_blend',
  'EXT_frag_depth', 'EXT_shader_texture_lod', 'EXT_sRGB',
  'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic', 'OES_element_index_uint',
  'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
  'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear',
  'OES_vertex_array_object', 'WEBGL_color_buffer_float',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context',
];
// Windows (ANGLE/Chromium-style) — 含 ANGLE 扩展
const WINDOWS_EXTENSIONS = [
  'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float',
  'EXT_float_blend', 'EXT_frag_depth', 'EXT_shader_texture_lod', 'EXT_sRGB',
  'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic', 'OES_element_index_uint',
  'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
  'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear',
  'OES_vertex_array_object', 'WEBGL_color_buffer_float',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context',
];
// Linux (Mesa) — 无 BPTC / S3TC_SRGB 压缩纹理
const LINUX_EXTENSIONS = [
  'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_float_blend',
  'EXT_frag_depth', 'EXT_shader_texture_lod', 'EXT_sRGB',
  'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic',
  'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
  'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_vertex_array_object',
  'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context',
];

const WEBGL_BY_OS: Record<FingerprintOS, WebGLEntry[]> = {
  macos: [
    {
      vendor: 'Apple', renderer: 'Apple M1',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: MACOS_EXTENSIONS,
    },
    {
      vendor: 'Apple', renderer: 'Apple M2',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: MACOS_EXTENSIONS,
    },
    {
      vendor: 'Apple', renderer: 'Apple M3',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: MACOS_EXTENSIONS,
    },
  ],
  windows: [
    {
      vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.1)',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: WINDOWS_EXTENSIONS,
    },
    {
      vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 32768, maxRenderbufferSize: 32768,
      maxViewportDims: [32768, 32768] as [number, number],
      extensions: WINDOWS_EXTENSIONS,
    },
    {
      vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660, OpenGL 4.5)',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: WINDOWS_EXTENSIONS,
    },
    {
      vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: WINDOWS_EXTENSIONS,
    },
  ],
  linux: [
    {
      vendor: 'Mesa', renderer: 'Mesa Intel(R) UHD Graphics 630',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: LINUX_EXTENSIONS,
    },
    {
      vendor: 'Mesa', renderer: 'Mesa AMD Radeon RX 580',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: LINUX_EXTENSIONS,
    },
    {
      vendor: 'X.Org', renderer: 'AMD Radeon RX 6600 XT',
      version: 'WebGL 1.0', shadingVersion: 'WebGL GLSL ES 1.0',
      maxTextureSize: 16384, maxRenderbufferSize: 16384,
      maxViewportDims: [16384, 16384] as [number, number],
      extensions: LINUX_EXTENSIONS,
    },
  ],
};

// ─── 工具函数 ───

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted<T>(items: { value: T; weight: number }[]): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function pickSubset<T>(arr: readonly T[], min: number, max: number): T[] {
  const count = randomInt(min, Math.min(max, arr.length));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ─── 指纹生成 ───

export function generateFingerprint(): FingerprintProfile {
  const os = pickWeighted(OS_POOL);
  const desktop = pickRandom(DESKTOP_VIEWPORTS);
  const mobile = pickRandom(MOBILE_VIEWPORTS);

  // screen 比 desktop viewport 大一点（taskbar 偏移）
  const taskbarHeight = randomInt(24, 80);
  const screen = {
    width: desktop.width,
    height: desktop.height + taskbarHeight,
    availHeight: desktop.height,
  };

  const localePair = pickWeighted(LOCALE_TIMEZONE_PAIRS.map(p => ({ value: p, weight: p.weight })));
  const locale = localePair.locale;
  const timezone = pickRandom(localePair.timezones);

  // 字体：按 OS 分组选取，保证一致性
  const fontPool = FONTS_BY_OS[os];
  const chineseFonts = pickSubset(fontPool.chinese, 2, 4);
  const latinFonts = pickSubset(fontPool.latin, 2, 3);
  const fonts = [...chineseFonts, ...latinFonts];

  // WebGL：按 OS 分组选取，保证一致性
  const webgl = pickRandom(WEBGL_BY_OS[os]);
  const canvasNoise = randomInt(1, 255);
  const chromeHeight = randomInt(70, 120);  // 标题栏+工具栏+书签栏
  const chromeBorder = randomInt(0, 2);     // 现代浏览器边框极窄

  // Audio 参数
  const audioSampleRate = Math.random() < 0.6 ? 44100 : 48000;
  const audioMaxChannelCount = Math.random() < 0.7 ? 2 : 6;
  const audioBaseLatency = 0.005 + Math.random() * 0.015;

  return {
    os,
    desktop,
    mobile,
    screen,
    locale,
    timezone,
    fonts,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    canvasNoise,
    chromeHeight,
    chromeBorder,
    webglVersion: webgl.version,
    webglShadingVersion: webgl.shadingVersion,
    webglMaxTextureSize: webgl.maxTextureSize,
    webglMaxRenderbufferSize: webgl.maxRenderbufferSize,
    webglMaxViewportDims: webgl.maxViewportDims,
    webglExtensions: webgl.extensions,
    audioSampleRate,
    audioMaxChannelCount,
    audioBaseLatency,
  };
}

// ─── 持久化 ───

const FINGERPRINT_FILE = 'fingerprint.json';

export function loadOrCreateFingerprint(userDataDir: string): FingerprintProfile {
  const filePath = join(userDataDir, FINGERPRINT_FILE);

  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as FingerprintProfile;
    } catch {
      // 文件损坏，重新生成
    }
  }

  const fp = generateFingerprint();
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(fp, null, 2));
  return fp;
}
