import { readFileSync } from 'node:fs';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.4';
let _client: any = null;
async function getClient(): Promise<any> {
  if (!_client) {
    const { default: OpenAI } = await import('openai' as any);
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL ?? 'https://cocode.cc/v1',
    });
  }
  return _client;
}

// ─── GPT 视觉驱动的验证码破解 ───

export interface SliderCaptchaResult {
  success: boolean;
  /** 滑块需要移动的 x 偏移量（像素） */
  offsetX: number;
  /** GPT 分析的置信度描述 */
  confidence: string;
}

export interface CaptchaAnalysisResult {
  /** 验证码类型 */
  type: 'slider' | 'click-text' | 'click-image' | 'unknown';
  /** 分析结果描述 */
  description: string;
  /** 滑块偏移（仅 slider 类型） */
  sliderOffset?: number;
  /** 需要点击的坐标列表（仅 click 类型） */
  clickPoints?: { x: number; y: number }[];
}

/**
 * 分析滑块验证码截图，返回滑块需要移动的 x 偏移
 */
export async function analyzeSliderCaptcha(screenshotPath: string): Promise<SliderCaptchaResult> {
  try {
    const imageBuffer = readFileSync(screenshotPath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = screenshotPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const response = await (await getClient()).chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `你是一个验证码分析专家。用户会给你一张滑块验证码的截图。
你需要分析图片中滑块缺口的位置，返回滑块需要从左向右移动的像素距离。

返回 JSON 格式：
{"offsetX": <number>, "confidence": "high" | "medium" | "low", "reasoning": "<简短说明>"}

注意：
- offsetX 是从滑块初始位置到缺口位置的水平像素距离
- 通常缺口是一个明显的拼图形状空缺
- 如果无法确定，返回 offsetX: 0 和 confidence: "low"`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: '请分析这张滑块验证码，告诉我滑块需要移动多少像素。' },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      log.info({ offsetX: parsed.offsetX, confidence: parsed.confidence }, '滑块验证码分析完成');
      return {
        success: parsed.offsetX > 0 && parsed.confidence !== 'low',
        offsetX: parsed.offsetX ?? 0,
        confidence: parsed.confidence ?? 'low',
      };
    }

    log.warn({ text: text.slice(0, 100) }, '滑块验证码分析结果解析失败');
    return { success: false, offsetX: 0, confidence: 'low' };
  } catch (err: any) {
    log.error({ err: err.message }, '滑块验证码分析异常');
    return { success: false, offsetX: 0, confidence: 'low' };
  }
}

/**
 * 通用验证码类型识别与分析
 */
export async function analyzeCaptcha(screenshotPath: string): Promise<CaptchaAnalysisResult> {
  try {
    const imageBuffer = readFileSync(screenshotPath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = screenshotPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const response = await (await getClient()).chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `你是一个验证码分析专家。分析截图中的验证码类型和解法。

返回 JSON 格式：
{
  "type": "slider" | "click-text" | "click-image" | "unknown",
  "description": "<验证码描述>",
  "sliderOffset": <number, 仅 slider 类型>,
  "clickPoints": [{"x": <number>, "y": <number>}, ...] （仅 click 类型，按顺序）
}

验证码类型说明：
- slider: 滑块拼图验证码，需要水平滑动
- click-text: 文字点选验证码（如"请依次点击：猫 狗 鸟"）
- click-image: 图片点选验证码（如"请点击包含红绿灯的图片"）
- unknown: 无法识别的类型`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: '请分析这张验证码截图。' },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.1,
    });

    const text = response.choices[0]?.message?.content ?? '';
    // 贪婪匹配最外层 {} — 处理含嵌套对象（如 clickPoints: [{x,y}]）的 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      log.info({ type: parsed.type }, '验证码分析完成');
      return {
        type: parsed.type ?? 'unknown',
        description: parsed.description ?? '',
        sliderOffset: parsed.sliderOffset,
        clickPoints: parsed.clickPoints,
      };
    }

    return { type: 'unknown', description: '分析结果解析失败' };
  } catch (err: any) {
    log.error({ err: err.message }, '验证码分析异常');
    return { type: 'unknown', description: `分析异常: ${err.message}` };
  }
}
