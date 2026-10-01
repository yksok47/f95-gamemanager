const BY_ID: Record<number, string> = {
  1: '👍',
  2: '❤️',
  3: '😆',
  4: '😮',
  5: '😢',
  7: '🤔',
  8: '😠',
  9: '👋',
  12: '🎉',
  13: '💦',
  14: '❤️',
  17: '👑'
}

const BY_TITLE: Record<string, string> = {
  like: '👍',
  love: '❤️',
  haha: '😆',
  wow: '😮',
  sad: '😢',
  angry: '😠',
  'thinking face': '🤔',
  'hey there': '👋',
  'yay, update!': '🎉',
  'jizzed my pants': '💦',
  heart: '❤️',
  crown: '👑'
}

export function reactionIcon(id: number, title: string): string {
  return BY_ID[id] || BY_TITLE[title.trim().toLowerCase()] || '⭐'
}
