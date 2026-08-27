import { enUS } from "./en-US";
import { zhCN, type MessageKey } from "./zh-CN";

export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";

export const messages: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export { enUS, zhCN, type MessageKey };

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
