import { zhCN, type MessageKey } from "./zh-CN";

export const DEFAULT_LOCALE = "zh-CN" as const;
export { zhCN, type MessageKey };

export function translate(key: MessageKey): string {
  return zhCN[key];
}

