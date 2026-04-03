type Page = any;

// ─── 键盘输入模拟引擎（含中文 IME） ───

// QWERTY 键盘物理距离矩阵（按键间曼哈顿距离，单位：按键宽度）
const KEY_POSITIONS: Record<string, [number, number]> = {
  'q': [0, 0], 'w': [1, 0], 'e': [2, 0], 'r': [3, 0], 't': [4, 0],
  'y': [5, 0], 'u': [6, 0], 'i': [7, 0], 'o': [8, 0], 'p': [9, 0],
  'a': [0.3, 1], 's': [1.3, 1], 'd': [2.3, 1], 'f': [3.3, 1], 'g': [4.3, 1],
  'h': [5.3, 1], 'j': [6.3, 1], 'k': [7.3, 1], 'l': [8.3, 1],
  'z': [0.6, 2], 'x': [1.6, 2], 'c': [2.6, 2], 'v': [3.6, 2], 'b': [4.6, 2],
  'n': [5.6, 2], 'm': [6.6, 2],
  '1': [0, -1], '2': [1, -1], '3': [2, -1], '4': [3, -1], '5': [4, -1],
  '6': [5, -1], '7': [6, -1], '8': [7, -1], '9': [8, -1], '0': [9, -1],
  ' ': [4.5, 3],
};

// 左右手按键分配（用于双手交替节奏计算）
const LEFT_HAND = new Set('qwertasdfgzxcvb12345'.split(''));

function keyDistance(a: string, b: string): number {
  const pa = KEY_POSITIONS[a.toLowerCase()];
  const pb = KEY_POSITIONS[b.toLowerCase()];
  if (!pa || !pb) return 2; // 未知键默认距离
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
}

function isSameHand(a: string, b: string): boolean {
  return LEFT_HAND.has(a.toLowerCase()) === LEFT_HAND.has(b.toLowerCase());
}

export interface TypingOptions {
  /** 基础按键间隔（ms） */
  baseInterval?: number;
  /** 打字错误概率（0-1） */
  errorRate?: number;
  /** 是否模拟中文 IME 输入 */
  useIME?: boolean;
  /** 指纹 OS — 影响快捷键（macOS 用 Meta，其他用 Control） */
  os?: 'macos' | 'windows' | 'linux';
}

export class KeyboardEngine {
  private lastKey = '';
  private readonly baseInterval: number;
  private readonly errorRate: number;
  private readonly useIME: boolean;
  private readonly modifierKey: string;

  constructor(options: TypingOptions = {}) {
    this.baseInterval = options.baseInterval ?? 120;
    this.errorRate = options.errorRate ?? 0.04;
    this.useIME = options.useIME ?? true;
    this.modifierKey = options.os === 'macos' ? 'Meta' : 'Control';
  }

  /** 计算两个按键之间的延迟 */
  private getKeyDelay(prevKey: string, currentKey: string): number {
    let delay = this.baseInterval;

    // 物理距离影响
    const dist = keyDistance(prevKey, currentKey);
    delay += dist * 15;

    // 同手连击较慢，双手交替较快
    if (prevKey && isSameHand(prevKey, currentKey)) {
      delay += 20 + Math.random() * 30;
    } else if (prevKey) {
      delay -= 15 + Math.random() * 15;
    }

    // 添加随机波动（±30%）
    delay *= 0.7 + Math.random() * 0.6;

    // 偶尔的长停顿（思考，2% 概率）
    if (Math.random() < 0.02) {
      delay += 300 + Math.random() * 700;
    }

    return Math.max(40, Math.round(delay));
  }

  /** 模拟 keydown → 延迟 → keyup */
  private async pressKey(page: Page, key: string): Promise<void> {
    await page.keyboard.down(key);
    // keydown-keyup 间隔：50-150ms
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    await page.keyboard.up(key);
  }

  /** 逐字符输入英文/拼音字母序列（底层） */
  private async typeRawChars(page: Page, text: string): Promise<void> {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const delay = this.getKeyDelay(this.lastKey, char);
      await new Promise(r => setTimeout(r, delay));

      // 打字错误模拟
      if (Math.random() < this.errorRate && char !== ' ') {
        // 按错一个相邻键
        const pos = KEY_POSITIONS[char.toLowerCase()];
        if (pos) {
          const neighbors = Object.entries(KEY_POSITIONS).filter(
            ([k, p]) => k !== char.toLowerCase() && Math.hypot(p[0] - pos[0], p[1] - pos[1]) < 1.5
          );
          if (neighbors.length > 0) {
            const wrongKey = neighbors[Math.floor(Math.random() * neighbors.length)][0];
            await this.pressKey(page, wrongKey);
            // 意识到错误的延迟
            await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
            // 退格删除
            await this.pressKey(page, 'Backspace');
            await new Promise(r => setTimeout(r, 100 + Math.random() * 150));
          }
        }
      }

      await this.pressKey(page, char);
      this.lastKey = char;
    }
  }

  /** 在搜索框等输入框中输入文本（主入口） */
  async typeText(page: Page, text: string, selector?: string): Promise<void> {
    // 如果提供了选择器，先聚焦
    if (selector) {
      await page.click(selector);
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
      // 清空已有内容
      await page.keyboard.down(this.modifierKey);
      await this.pressKey(page, 'a');
      await page.keyboard.up(this.modifierKey);
      await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
      await this.pressKey(page, 'Backspace');
      await new Promise(r => setTimeout(r, 200 + Math.random() * 200));
    }

    if (this.useIME && this.containsChinese(text)) {
      await this.typeWithIME(page, text);
    } else {
      await this.typeRawChars(page, text);
    }
  }

  /** 判断文本是否包含中文 */
  private containsChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  /** 中文 IME 模拟输入 — 通过 page.evaluate 直接设置值 + 触发事件
   *  实际场景中浏览器的 IME 输入通过 compositionstart/update/end 事件序列实现 */
  private async typeWithIME(page: Page, text: string): Promise<void> {
    // 将文本拆分为中文段和非中文段
    const segments = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [];

    for (const segment of segments) {
      if (this.containsChinese(segment)) {
        // 中文段：模拟 composition 事件序列
        // 每个字符通过 compositionstart → compositionupdate → compositionend 输入
        for (let i = 0; i < segment.length; i++) {
          const char = segment[i];

          // 模拟音节输入前的思考停顿
          if (i > 0) {
            await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
          }

          // 触发 composition 事件序列
          await page.evaluate((c: string) => {
            const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
            if (!el) return;

            el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
            el.dispatchEvent(new CompositionEvent('compositionupdate', { data: c }));
            el.dispatchEvent(new CompositionEvent('compositionend', { data: c }));

            // 插入文本
            if ('value' in el) {
              const start = el.selectionStart ?? el.value.length;
              const end = el.selectionEnd ?? el.value.length;
              el.value = el.value.slice(0, start) + c + el.value.slice(end);
              el.selectionStart = el.selectionEnd = start + c.length;
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, char);

          // 字符间延迟（模拟拼音输入 + 候选词选择）
          await new Promise(r => setTimeout(r, 150 + Math.random() * 300));
        }
      } else {
        // 非中文段：正常逐字输入
        await this.typeRawChars(page, segment);
      }
    }
  }

  /** 输入完成后按回车（带自然延迟） */
  async pressEnter(page: Page): Promise<void> {
    // 输入完成后的确认停顿
    await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
    await this.pressKey(page, 'Enter');
  }

  /** 输入完成后点击搜索按钮（替代回车，20% 概率） */
  async clickSearchButton(page: Page, selector: string): Promise<void> {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
    await page.click(selector);
  }
}
