# @kajidog/tts-client

TypeScript client library for multi-engine text-to-speech.

## Usage

```ts
import { TtsClient } from '@kajidog/tts-client'

const client = new TtsClient({
  engine: 'voicevox',
  baseUrl: 'http://localhost:50021',
  defaultSpeaker: 3,
})

await client.speak('こんにちは')
```

Sakura AI Engine:

```ts
const client = new TtsClient({
  engine: 'sakuraai',
  apiKey: process.env.TTS_API_KEY,
  defaultSpeaker: 3,
})
```

For advanced integration, use `createEngine`, `VoicevoxEngine`, `SakuraAiEngine`, and `TtsEngine`.
