# Vex

Vex is a goth tarot reader for a Halloween party. A guest holds the space bar and asks a question out loud. Vex repeats the question, mocks it, deals three cards and reads them in her own voice.

A reading takes about 70 seconds.

## How a reading works

1. The guest holds space. The kiosk records the microphone.
2. The guest lets go. The kiosk sends the audio to `/api/stt` (ElevenLabs Scribe).
3. The kiosk sends the text to `/api/roast` and `/api/reading` at the same time.
4. Vex speaks the roast. While she speaks, the server writes the reading.
5. The deck shuffles for at least 2.5 seconds, then deals three cards face down.
6. Each card flips. Vex reads it. The next card waits until she stops.
7. Vex gives a verdict.

The server draws the cards with a random number generator. The model reads the cards but does not choose them.

## Run it

You need Node 22 and Wrangler.

1. Create `.dev.vars` with two keys:

   ```
   ELEVENLABS_KEY=...
   OPENROUTER_KEY=...
   ```

2. Start the server:

   ```
   npm run dev
   ```

3. Open http://localhost:8787 in Chrome. Click **Wake Vex** and allow the microphone.

## Controls

| Key | Action |
| --- | --- |
| Hold space | Record a question. Let go to send it. |
| `d` | Show or hide the debug log (timings, transcript). |

After a reading, the full email letter is in `window.lastReading.letter` in the browser console.

## Settings

Set these in `wrangler.jsonc` under `vars`.

| Name | Default | What it changes |
| --- | --- | --- |
| `VOICE_ID` | `X6VIT9ZXy5Nr7EmuLOGz` (Daria) | Vex's voice. Other options: Bella `hbB2qXyS2GMyyZIZyhAH`, Minerva `fgDJOgmENIR82PueQrVs`, Blondie `YDCfZMLWcUmsGvqHq0rS`. |
| `TTS_SPEED` | `1.15` | Speaking speed, 0.7 to 1.2. |
| `LLM_MODEL` | `moonshotai/kimi-k3` | The model on OpenRouter. Reasoning is off. |
| `TTS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs voice model. |
| `STT_MODEL` | `scribe_v1` | The ElevenLabs speech-to-text model. |

The persona and the output rules are in `src/persona.js`.

## Safety

If a guest talks about self-harm, grief, abuse or a health scare, Vex stops the reading. She says one kind line and gives the Samaritans number. The number is fixed text in `src/worker.js`, not model output. No cards are dealt.

## Test

The end-to-end test plays `test/question.wav` into a fake microphone, holds space and saves a screenshot of each stage to `test/shots/`.

```
npm run dev            # in one terminal
CHROME=/path/to/chrome npm run test:e2e
```

## Card images

The cards are the 1909 Rider-Waite-Smith deck, which is in the public domain. The scans come from [metabismuth/tarot-json](https://github.com/metabismuth/tarot-json) (MIT).
