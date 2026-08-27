export const zhCN = {
  "app.name": "涌流",
  "nav.search": "搜索",
  "nav.downloading": "下载中",
  "nav.completed": "已完成",
  "nav.settings": "设置",
  "nav.about": "关于",
  "search.eyebrow": "本地检索 · 多源聚合",
  "search.title": "从一个入口，抵达整个网络。",
  "search.placeholder": "输入关键词、Magnet 或 infohash",
  "search.action": "开始搜索",
  "search.emptyTitle": "搜索结果会在这里汇流",
  "search.emptyBody": "不同来源独立响应；某个来源暂不可用时，不会影响其他结果。",
  "downloads.emptyTitle": "下载队列安静待命",
  "downloads.emptyBody": "从搜索结果开始下载后，可在这里查看进度、速度与预计时间。",
  "completed.emptyTitle": "还没有完成的任务",
  "completed.emptyBody": "下载完成后，可在这里打开文件夹并管理做种状态。",
  "error.sourceUnavailable": "该搜索来源连接失败，可稍后重试",
  "status.localOnly": "本机模式",
} as const;

export type MessageKey = keyof typeof zhCN;

