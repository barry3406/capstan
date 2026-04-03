import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateFingerprint, loadOrCreateFingerprint } from '../../../packages/ai/dist/harness/kernel/stealth/fingerprint.js';

const TMP_DIR = join(process.cwd(), '.tmp-fp-test');

function cleanup() {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
}

describe('generateFingerprint', () => {
  it('生成完整的指纹配置', () => {
    const fp = generateFingerprint();

    expect(['macos', 'windows', 'linux']).toContain(fp.os);
    expect(fp.desktop.width).toBeGreaterThan(0);
    expect(fp.desktop.height).toBeGreaterThan(0);
    expect(fp.mobile.width).toBeGreaterThan(0);
    expect(fp.mobile.height).toBeGreaterThan(0);
    expect(fp.screen.width).toBe(fp.desktop.width);
    expect(fp.screen.height).toBeGreaterThan(fp.desktop.height);
    expect(fp.screen.availHeight).toBe(fp.desktop.height);
    expect(fp.locale).toMatch(/^zh-/);
    expect(fp.timezone).toMatch(/^Asia\//);
    expect(fp.fonts.length).toBeGreaterThanOrEqual(4);
    expect(fp.webglVendor).toBeTruthy();
    expect(fp.webglRenderer).toBeTruthy();
    expect(fp.canvasNoise).toBeGreaterThanOrEqual(1);
    expect(fp.canvasNoise).toBeLessThanOrEqual(255);
  });

  it('字体与 OS 一致 — macOS 不含 Microsoft YaHei', () => {
    for (let i = 0; i < 30; i++) {
      const fp = generateFingerprint();
      if (fp.os === 'macos') {
        expect(fp.fonts).not.toContain('Microsoft YaHei');
        expect(fp.fonts).not.toContain('SimHei');
      }
      if (fp.os === 'windows') {
        expect(fp.fonts).not.toContain('PingFang SC');
        expect(fp.fonts).not.toContain('STHeiti');
      }
    }
  });

  it('WebGL 与 OS 一致 — 非 macOS 不含 Apple vendor', () => {
    for (let i = 0; i < 30; i++) {
      const fp = generateFingerprint();
      if (fp.os !== 'macos') {
        expect(fp.webglVendor).not.toBe('Apple');
      }
      if (fp.os === 'linux') {
        expect(fp.webglVendor).toMatch(/Mesa|X\.Org/);
      }
    }
  });

  it('多次生成的指纹不完全相同（随机性）', () => {
    const fps = Array.from({ length: 20 }, () => generateFingerprint());
    const oses = new Set(fps.map(f => f.os));
    const viewports = new Set(fps.map(f => `${f.desktop.width}x${f.desktop.height}`));
    expect(oses.size + viewports.size).toBeGreaterThan(2);
  });
});

describe('loadOrCreateFingerprint', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('目录不存在时创建目录并生成指纹文件', () => {
    const dir = join(TMP_DIR, 'acc_1');
    const fp = loadOrCreateFingerprint(dir);

    expect(existsSync(join(dir, 'fingerprint.json'))).toBe(true);
    expect(fp.os).toBeTruthy();
  });

  it('同一目录多次调用返回相同指纹', () => {
    const dir = join(TMP_DIR, 'acc_2');
    const fp1 = loadOrCreateFingerprint(dir);
    const fp2 = loadOrCreateFingerprint(dir);
    expect(fp1).toEqual(fp2);
  });

  it('不同目录生成不同指纹', () => {
    const fp1 = loadOrCreateFingerprint(join(TMP_DIR, 'acc_a'));
    const fp2 = loadOrCreateFingerprint(join(TMP_DIR, 'acc_b'));
    expect(JSON.stringify(fp1)).not.toBe(JSON.stringify(fp2));
  });

  it('指纹文件可被正确反序列化', () => {
    const dir = join(TMP_DIR, 'acc_3');
    const fp = loadOrCreateFingerprint(dir);
    const raw = JSON.parse(readFileSync(join(dir, 'fingerprint.json'), 'utf-8'));
    expect(raw).toEqual(fp);
  });
});
