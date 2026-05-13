export const EMOTION_NAMES = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'serious'] as const

export type EmotionName = (typeof EMOTION_NAMES)[number]

export interface EmotionBinding {
  emotion: EmotionName
  expressionName?: string
  speakerId?: number
  weight?: number
}

export function isEmotionName(value: string): value is EmotionName {
  return (EMOTION_NAMES as readonly string[]).includes(value)
}

export function normalizeEmotion(value: string | undefined): EmotionName {
  return value && isEmotionName(value) ? value : 'neutral'
}
