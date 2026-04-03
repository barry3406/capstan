type BrowserContext = any;

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserEngine, BrowserEngineOptions } from './types.js';
import { loadOrCreateFingerprint, type FingerprintProfile } from '../stealth/fingerprint.js';
import { buildStealthScript } from '../stealth/init-script.js';
import { SocksAuthTunnel, parseSocksAuth } from './socks-tunnel.js';

export class CamoufoxEngine implements BrowserEngine {
  readonly name = 'camoufox';
  private context: BrowserContext | null = null;
  private persistent = false;
  private socksTunnel: SocksAuthTunnel | null = null;

  hasSession(userDataDir: string): boolean {
    return existsSync(join(userDataDir, 'cookies.sqlite'));
  }

  async launch(options: BrowserEngineOptions): Promise<BrowserContext> {
    let Camoufox: (opts: Record<string, unknown>) => Promise<BrowserContext | any>;
    try {
      // @ts-ignore camoufox-js 可能无类型声明
      ({ Camoufox } = await import('camoufox-js'));
    } catch {
      throw new Error(
        'camoufox-js 未安装或浏览器二进制缺失。请执行:\n' +
        '  npm install camoufox-js playwright-core\n' +
        '  npx camoufox-js fetch'
      );
    }

    // 加载或生成指纹（有 userDataDir 时持久化）
    const fp: FingerprintProfile | null = options.userDataDir
      ? loadOrCreateFingerprint(options.userDataDir)
      : null;

    // viewport: 优先使用显式传入 > 指纹 > 默认
    const viewport = options.viewport
      ?? (fp
        ? (options.mobile ? fp.mobile : fp.desktop)
        : { width: 1920, height: 1080 });

    // Camoufox 渲染用的字体必须是宿主系统上实际安装的，与指纹 OS 无关
    const HOST_FONTS = process.platform === 'darwin'
      ? ['PingFang SC', 'STHeiti', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC',
         'Arial', 'Helvetica', 'Times New Roman']
      : process.platform === 'win32'
      ? ['Microsoft YaHei', 'SimHei', 'SimSun', 'NSimSun', 'Noto Sans CJK SC',
         'Arial', 'Helvetica', 'Times New Roman']
      : ['Noto Sans CJK SC', 'WenQuanYi Micro Hei', 'Source Han Sans SC', 'Droid Sans Fallback',
         'Arial', 'Helvetica', 'Times New Roman'];

    const camoufoxOpts: Record<string, unknown> = {
      headless: options.headless ?? true,
      geoip: false,
      humanize: options.humanize ?? 2.0,
      block_webrtc: true,  // 阻止 WebRTC 泄露真实 IP — 电商场景不需要 WebRTC
      enable_cache: true,
      window: [viewport.width, viewport.height],
      os: [process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'],
      fonts: HOST_FONTS,
      custom_fonts_only: false,
      exclude_addons: ['UBO'],
    };

    if (options.proxy) {
      const proxyStr = typeof options.proxy === 'string'
        ? options.proxy
        : this.buildProxyUrl(options.proxy);

      // Playwright Firefox 不支持 SOCKS5 认证代理（抛 "Browser does not support socks5 proxy authentication"），
      // 且 camoufox-js 对 socks5 URL 使用 URL.origin（返回 "null"）导致代理失败。
      // 绕过方案：启动本地无认证 SOCKS5 隧道，通过 firefox_user_prefs 配置 Firefox 使用本地隧道。
      const socksAuth = parseSocksAuth(proxyStr);
      if (socksAuth) {
        this.socksTunnel = new SocksAuthTunnel(socksAuth);
        const localPort = await this.socksTunnel.start();
        camoufoxOpts.firefox_user_prefs = {
          ...(camoufoxOpts.firefox_user_prefs as Record<string, unknown> ?? {}),
          'network.proxy.type': 1,
          'network.proxy.socks': '127.0.0.1',
          'network.proxy.socks_port': localPort,
          'network.proxy.socks_version': 5,
          'network.proxy.socks_remote_dns': true,
          'network.proxy.no_proxies_on': 'localhost, 127.0.0.1',
        };
      } else {
        // 标准 http/https 协议走 camoufox 原生 proxy 参数（URL.origin 正常）
        camoufoxOpts.proxy = proxyStr;
      }
    }

    if (options.userDataDir) {
      this.persistent = true;
      camoufoxOpts.user_data_dir = options.userDataDir;
    } else {
      this.persistent = false;
    }

    const result = await Camoufox(camoufoxOpts);

    if (this.persistent) {
      this.context = result as BrowserContext;
    } else {
      const browser = result as any;
      const contexts = browser.contexts();
      this.context = contexts.length > 0
        ? contexts[0]
        : await browser.newContext({ viewport });
    }

    // Camoufox 的 window 参数设置的是 Firefox 窗口大小，
    // 但 Playwright 的 viewport 跟踪可能不同步（persistent context 尤其明显）。
    // 显式对所有 page 设置 viewportSize，确保截图和页面渲染尺寸正确。
    const ensureViewport = async (page: any) => {
      try { await page.setViewportSize(viewport); } catch { /* page may be closed */ }
    };
    for (const page of this.context.pages()) await ensureViewport(page);
    this.context.on('page', ensureViewport);

    // 注入反检测脚本 + HTTP 头
    if (fp) {
      await this.context.addInitScript(buildStealthScript(fp));
      // Accept-Language 与 navigator.languages 保持一致
      await this.context.setExtraHTTPHeaders({
        'Accept-Language': `${fp.locale},en-US;q=0.9,en;q=0.8`,
      });
    }

    return this.context;
  }

  private buildProxyUrl(proxy: { server: string; username?: string; password?: string }): string {
    const { server, username, password } = proxy;
    const hasProtocol = /^[a-z][a-z0-9+\-.]*:\/\//i.test(server);
    const serverPart = hasProtocol ? server : `http://${server}`;
    if (!username) return serverPart;
    const url = new URL(serverPart);
    url.username = username;
    if (password) url.password = password;
    return url.toString().replace(/\/$/, '');
  }

  async close(): Promise<void> {
    if (this.persistent) {
      await this.context?.close();
    } else {
      const browser = this.context?.browser();
      await this.context?.close();
      await browser?.close();
    }
    this.context = null;
    await this.socksTunnel?.close();
    this.socksTunnel = null;
  }
}
