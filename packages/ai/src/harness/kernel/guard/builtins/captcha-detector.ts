import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import type { GuardFn, GuardContext } from '../types.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

// 每个账号每小时最多尝试自动破解的次数
const MAX_SOLVE_ATTEMPTS_PER_HOUR = 3;
const solveAttempts = new Map<string, { count: number; resetAt: number }>();

function canAttemptSolve(accountId: string): boolean {
  const now = Date.now();
  const record = solveAttempts.get(accountId);
  if (!record || now >= record.resetAt) {
    solveAttempts.set(accountId, { count: 0, resetAt: now + 3600_000 });
    return true;
  }
  return record.count < MAX_SOLVE_ATTEMPTS_PER_HOUR;
}

function recordSolveAttempt(accountId: string): void {
  const record = solveAttempts.get(accountId);
  if (record) record.count++;
}

/**
 * 验证码检测守卫 — 检测到验证码后尝试 GPT 破解，失败才抛异常
 * @param extraSelectors 额外的验证码选择器（平台特定）
 */
export function captchaDetector(extraSelectors?: string[]): GuardFn {
  const selectors = [
    '#nocaptcha',
    '.nc-container',
    '#nc_1_wrapper',
    '.baxia-dialog',
    'iframe[src*="captcha"]',
    'iframe[src*="punish"]',
    ...(extraSelectors ?? []),
  ];

  return async (ctx) => {
    const hasCaptcha = await ctx.session.evaluate((sels: string[]) => {
      return sels.some(sel => document.querySelector(sel) !== null);
    }, selectors);

    if (!hasCaptcha) return;

    ctx.logger.warn({ url: ctx.url, accountId: ctx.session.accountId }, '检测到验证码');

    // 尝试 GPT 自动破解（限流保护）
    if (canAttemptSolve(ctx.session.accountId)) {
      recordSolveAttempt(ctx.session.accountId);
      const solved = await attemptSolve(ctx, selectors);
      if (solved) {
        ctx.logger.info({ accountId: ctx.session.accountId }, '验证码自动破解成功');
        return; // 破解成功，不抛异常
      }
      ctx.logger.warn({ accountId: ctx.session.accountId }, '验证码自动破解失败，进入 cooldown');
    }

    throw new Error('验证码: 页面包含滑块验证');
  };
}

/** 尝试自动破解验证码 */
async function attemptSolve(ctx: GuardContext, allSelectors: string[]): Promise<boolean> {
  const tmpPath = join(tmpdir(), `captcha_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  try {
    // 截图
    await ctx.session.screenshot(tmpPath);

    // 动态导入 — 避免在没有 openai 包时崩溃
    let analyzeSliderCaptcha: typeof import('../../ai/captcha-solver.js').analyzeSliderCaptcha;
    try {
      ({ analyzeSliderCaptcha } = await import('../../ai/captcha-solver.js'));
    } catch {
      log.debug('captcha-solver 模块不可用，跳过自动破解');
      return false;
    }

    const result = await analyzeSliderCaptcha(tmpPath);
    if (!result.success || result.offsetX <= 0) {
      return false;
    }

    // 查找滑块手柄并获取其坐标
    const sliderHandle = await ctx.session.evaluate(() => {
      const candidates = [
        '#nc_1_n1z',           // 阿里滑块手柄
        '.btn_slide',          // 通用滑块
        '.slider-btn',
        '.slide-btn',
        '.JDJRV-slide-btn',    // 京东滑块
        '[class*="slider"] [class*="btn"]',
        '[class*="slide"] [class*="handle"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
        }
      }
      return { x: 0, y: 0, found: false };
    });

    if (!sliderHandle.found) {
      log.debug('未找到滑块手柄元素');
      return false;
    }

    // 通过 evaluate 在浏览器端执行拖动 —— KernelSession 不暴露 page.mouse，
    // 因此在 DOM 层面派发 pointer/mouse 事件来模拟拖拽
    const dragSuccess = await ctx.session.evaluate(
      (startX: number, startY: number, offsetX: number) => {
        return new Promise<boolean>(resolve => {
          const el = document.elementFromPoint(startX, startY);
          if (!el) { resolve(false); return; }

          const endX = startX + offsetX;
          const steps = 15 + Math.floor(Math.random() * 10);

          function dispatch(target: Element, type: string, x: number, y: number) {
            target.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, clientX: x, clientY: y,
              pointerId: 1, pointerType: 'mouse',
            }));
            target.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, clientX: x, clientY: y,
            }));
          }

          // 按住
          dispatch(el, 'pointerdown', startX, startY);
          dispatch(el, 'mousedown', startX, startY);

          let i = 0;
          const interval = setInterval(() => {
            i++;
            if (i > steps) {
              clearInterval(interval);
              // 最终位置 + 释放
              dispatch(el, 'pointermove', endX, startY);
              dispatch(el, 'mousemove', endX, startY);
              dispatch(el, 'pointerup', endX, startY);
              dispatch(el, 'mouseup', endX, startY);

              // 等待验证结果后检查
              setTimeout(() => resolve(true), 1500 + Math.random() * 1000);
              return;
            }

            const t = i / steps;
            // 缓入缓出 easing
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const currentX = startX + (endX - startX) * eased + (Math.random() - 0.5) * 2;
            const currentY = startY + (Math.random() - 0.5) * 3;
            dispatch(el, 'pointermove', currentX, currentY);
            dispatch(el, 'mousemove', currentX, currentY);
          }, 8 + Math.random() * 12);
        });
      },
      sliderHandle.x, sliderHandle.y, result.offsetX,
    );

    if (!dragSuccess) return false;

    // 检查验证码是否消失
    const stillHasCaptcha = await ctx.session.evaluate((sels: string[]) => {
      return sels.some(sel => document.querySelector(sel) !== null);
    }, allSelectors);

    return !stillHasCaptcha;
  } catch (err: any) {
    log.warn({ err: err.message }, '验证码自动破解异常');
    return false;
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}
