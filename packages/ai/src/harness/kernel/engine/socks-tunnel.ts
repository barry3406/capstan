/**
 * 本地 SOCKS5 认证隧道
 *
 * Playwright Firefox 不支持 SOCKS5 认证代理（会抛 "Browser does not support socks5 proxy authentication"）。
 * 解决方案：在本地启动无认证 SOCKS5 服务器，将连接通过上游认证 SOCKS5 代理转发。
 *
 * Firefox → 127.0.0.1:localPort (无认证) → 远程 SOCKS5 (带认证) → 目标
 */
import { createServer, type Server, type Socket } from 'net';

// Dynamic import — socks is optional peer dependency
let _SocksClient: any = null;
async function getSocksClient(): Promise<any> {
  if (!_SocksClient) {
    const mod = await import('socks' as any);
    _SocksClient = mod.SocksClient;
  }
  return _SocksClient;
}

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

export interface SocksTunnelOptions {
  host: string;
  port: number;
  username: string;
  password: string;
}

export class SocksAuthTunnel {
  private server: Server | null = null;
  private localPort = 0;
  private readonly upstream: SocksTunnelOptions;

  constructor(upstream: SocksTunnelOptions) {
    this.upstream = upstream;
  }

  /** 启动本地 SOCKS5 隧道，返回本地端口 */
  async start(): Promise<number> {
    if (this.server) return this.localPort;

    return new Promise<number>((resolve, reject) => {
      const srv = createServer((client) => this.handleClient(client));
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') { reject(new Error('无法获取端口')); return; }
        this.localPort = addr.port;
        this.server = srv;
        log.info({ port: this.localPort, upstream: `${this.upstream.host}:${this.upstream.port}` },
          'SOCKS5 认证隧道已启动');
        resolve(this.localPort);
      });
    });
  }

  /** 关闭隧道 */
  async close(): Promise<void> {
    if (!this.server) return;
    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        log.info({ port: this.localPort }, 'SOCKS5 认证隧道已关闭');
        this.server = null;
        this.localPort = 0;
        resolve();
      });
    });
  }

  get port(): number { return this.localPort; }
  get isRunning(): boolean { return this.server !== null; }

  // ── 内部实现 ──

  private handleClient(client: Socket): void {
    let state: 'greeting' | 'request' | 'done' = 'greeting';
    let buf = Buffer.alloc(0);

    client.on('data', async (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      if (state === 'greeting') {
        // SOCKS5 greeting: VER NMETHODS METHODS...
        if (buf.length < 3) return;
        if (buf[0] !== 5) { client.destroy(); return; }
        // 回复：无需认证
        client.write(Buffer.from([0x05, 0x00]));
        buf = buf.slice(2 + buf[1]);
        state = 'request';
      }

      if (state === 'request') {
        const parsed = this.parseRequest(buf);
        if (!parsed) return; // 数据不完整，等待更多
        if (parsed.error) { client.destroy(); return; }

        state = 'done';
        const { host, port, headerLen } = parsed as { host: string; port: number; headerLen: number };
        const remaining = buf.slice(headerLen);

        try {
          const SC = await getSocksClient();
          const { socket: upstream } = await SC.createConnection({
            proxy: {
              host: this.upstream.host,
              port: this.upstream.port,
              type: 5,
              userId: this.upstream.username,
              password: this.upstream.password,
            },
            command: 'connect',
            destination: { host, port },
          });

          // SOCKS5 成功回复
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

          // 双向管道
          if (remaining.length > 0) upstream.write(remaining);
          client.pipe(upstream);
          upstream.pipe(client);

          upstream.on('error', () => client.destroy());
          client.on('error', () => upstream.destroy());
          upstream.on('close', () => client.destroy());
          client.on('close', () => upstream.destroy());
        } catch {
          // 连接失败回复
          client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.destroy();
        }
      }
    });

    client.on('error', () => {});
  }

  private parseRequest(buf: Buffer): { host: string; port: number; headerLen: number; error?: false } | { error: true } | null {
    if (buf.length < 4) return null;
    const cmd = buf[1];
    const atyp = buf[3];

    if (cmd !== 1) {
      // 只支持 CONNECT
      return { error: true };
    }

    if (atyp === 1) { // IPv4
      if (buf.length < 10) return null;
      const host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
      return { host, port: buf.readUInt16BE(8), headerLen: 10 };
    }

    if (atyp === 3) { // Domain
      if (buf.length < 5) return null;
      const dl = buf[4];
      if (buf.length < 5 + dl + 2) return null;
      const host = buf.slice(5, 5 + dl).toString();
      return { host, port: buf.readUInt16BE(5 + dl), headerLen: 5 + dl + 2 };
    }

    if (atyp === 4) { // IPv6
      if (buf.length < 22) return null;
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(4 + i * 2).toString(16));
      return { host: parts.join(':'), port: buf.readUInt16BE(20), headerLen: 22 };
    }

    return { error: true };
  }
}

/**
 * 解析 SOCKS5 代理 URL，提取认证信息。
 * 返回 null 表示不需要隧道（无认证或非 socks5）。
 */
export function parseSocksAuth(proxyUrl: string): SocksTunnelOptions | null {
  try {
    const u = new URL(proxyUrl);
    const scheme = u.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'socks5' && scheme !== 'socks') return null;
    if (!u.username) return null;
    return {
      host: u.hostname,
      port: parseInt(u.port, 10) || 1080,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || ''),
    };
  } catch {
    return null;
  }
}
