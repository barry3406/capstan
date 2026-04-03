export interface KernelSession {
  readonly accountId: string;
  readonly engine: string;
  readonly platform: string;
  /** 当前页面 URL */
  url(): string;
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  waitForNavigation(options?: { timeout?: number }): Promise<void>;
  fetch(url: string, init?: RequestInit): Promise<any>;
  intercept(urlPattern: string | RegExp, handler: (resp: any) => void): Disposable;
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
  querySelector(selector: string): Promise<any>;
  getCookies(): Promise<Array<{ name: string; value: string }>>;
  hasCookie(name: string): Promise<boolean>;
  humanDelay(min: number, max: number): Promise<void>;
  humanScroll(): Promise<void>;
  screenshot(path: string, options?: ScreenshotOptions): Promise<void>;
  close(): Promise<void>;
}

export interface ScreenshotOptions {
  /** 是否截取整个可滚动页面（默认 true） */
  fullPage?: boolean;
  /** 只截首屏（视口宽度 × 一屏高度），等价于 fullPage: false */
  viewportOnly?: boolean;
  /**
   * 智能首屏截图：宽度取 body 实际渲染宽度，高度取一屏可见内容高度。
   * 传 true 使用默认高度（window.innerHeight），传数字指定截图高度（像素）。
   * 优先级: selector > aboveFold > clip > viewportOnly > fullPage
   */
  aboveFold?: boolean | number;
  /** 仅截取指定 CSS 选择器匹配的元素 */
  selector?: string;
  /** 裁剪区域（像素） */
  clip?: { x: number; y: number; width: number; height: number };
  /** 图片格式 */
  type?: 'png' | 'jpeg';
  /** JPEG 质量 0-100（仅 type=jpeg 时有效） */
  quality?: number;
  /** 是否忽略 CSS 背景（透明背景，仅 png 有效） */
  omitBackground?: boolean;
}
