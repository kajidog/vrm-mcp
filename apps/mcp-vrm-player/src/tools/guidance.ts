import { BUILTIN_POSE_IDS } from './pose-registry/types.js'

export const EMOTION_GUIDE = 'neutral, happy, angry, sad, relaxed, surprised, serious'

export const DEFAULT_POSE_NAMES = [...BUILTIN_POSE_IDS]

export const MCP_APPS_UNAVAILABLE_GUIDE =
  'The player and model manager require an MCP client that can display MCP Apps UI. If the UI did not open, use an MCP Apps-compatible client and reconnect this server.'

export const REGISTRATION_GUIDE_FULL = [
  'No VRM model is registered yet. Explain this setup to the user:',
  '1. Get a .vrm model file from a VRM-compatible creator/exporter or a distribution site where the license allows local use.',
  '2. Open the model manager UI, drop or select the .vrm file, choose the TTS speaker, and save it.',
  '3. Mark the model as the default if they want future speak_player calls to use it automatically.',
  '4. Optional VRMA poses can be added in pose management, then assigned to model pose names in the model edit screen.',
  '5. Next time, pass knowsHowToUse: true to open_model_manager if the user already knows these steps.',
].join('\n')

export const REGISTRATION_GUIDE_SHORT =
  'The model manager UI was opened. Register or edit a VRM model there. Detailed setup instructions are omitted because knowsHowToUse was true.'

export function getRegistrationGuide(knowsHowToUse?: boolean): string {
  return knowsHowToUse ? REGISTRATION_GUIDE_SHORT : REGISTRATION_GUIDE_FULL
}
