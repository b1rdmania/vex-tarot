# Vex

Vex is a goth tarot reader for a Halloween party. A guest sits down, presses space and talks to her. Vex asks what they want to know, mocks the question, deals five cards and reads them one at a time. The guest can talk back at any point. A session takes about three minutes.

There are two versions:

- **Live** (`/`). A real-time voice session through LiveKit. A video face from HeyGen LiveAvatar is optional.
- **Classic** (`/classic/`). The first build: push-to-talk, three cards, one question. It needs no LiveKit, so it is the fallback.

## How a live session works

1. The guest presses space. The kiosk asks `/api/token` for a LiveKit token. The token puts the `vex` agent in a new room.
2. The agent worker (`agent/agent.js`) joins. Deepgram transcribes the guest, Kimi K3 (on OpenRouter) writes Vex's lines and ElevenLabs speaks them. If `LIVEAVATAR_API_KEY` is set, LiveAvatar renders her face from the same audio.
3. Before she speaks, the worker draws ten cards with a crypto random number generator and puts them in her instructions. The model does not choose them. The kiosk gets the same list.
4. When Vex has the question, the model calls `deal` with the spread (five cards, or the Celtic Cross if asked). The kiosk lays the cards face down.
5. She reads the cards in order. The kiosk flips each one when her synced subtitles say its name. If `deal` never arrives, the kiosk lays the short spread when she names the first card. Nothing on screen depends on a tool call, because K3 sometimes writes a tool call as text instead of making it.
6. The reading ends with the line that names the last card. The worker deletes the room and the kiosk hangs up and resets.

A session also ends if the guest is silent for 30 seconds. After 8 minutes Vex is told to wrap up.

## Run it

You need Node 22 and Wrangler.

1. Put these keys in `.dev.vars` (the kiosk Worker):

   ```
   ELEVENLABS_KEY=...
   OPENROUTER_KEY=...
   LIVEKIT_URL=wss://...
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   ```

2. Put these keys in `agent/.env` (the agent worker):

   ```
   LIVEKIT_URL=wss://...
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   DEEPGRAM_API_KEY=...
   ELEVENLABS_KEY=...
   OPENROUTER_KEY=...
   LIVEAVATAR_API_KEY=...   # optional; without it Vex is voice only
   LIVEAVATAR_SANDBOX=0     # 1 = free "Wayne" test avatar, 1-minute sessions, no credits
   LIVEAVATAR_AVATAR_ID=... # used when LIVEAVATAR_SANDBOX=0; Ella (Disinterested) is 4c9a4e2d-67df-465a-b6ca-4199b26cebb9
   ```

3. Start both:

   ```
   npm run dev                 # kiosk on http://localhost:8787
   cd agent && npm run dev     # agent worker
   ```

4. Open http://localhost:8787 in Chrome, allow the microphone and press space.

## Controls

| Key | Action |
| --- | --- |
| Space | Start a session. |
| Escape | End the session now. |
| `d` | Show or hide the debug log. |

## Settings

The agent reads these from `agent/.env`.

| Name | Default | What it changes |
| --- | --- | --- |
| `VOICE_ID` | `X6VIT9ZXy5Nr7EmuLOGz` (Daria) | Vex's ElevenLabs voice. Use a cloned voice for a real person. |
| `TTS_SPEED` | `1.1` | Speaking speed, 0.7 to 1.2. |
| `LLM_MODEL` | `moonshotai/kimi-k3` | The model on OpenRouter. Reasoning is off. |
| `TTS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs voice model. |
| `VEX_MAX_SESSION_S` | `480` | Session length before Vex wraps up. |

The persona, the spreads and the crisis screen are in `agent/persona.js`.

## Safety

If a guest talks about self-harm, hopelessness, a death, abuse or a health scare, Vex stops the reading. She says one kind line and gives the Samaritans number. The line is fixed text in `agent/persona.js`, not model output.

Two checks can stop a session:

- A pattern screen on every transcript, including words said while Vex is talking. It runs before the model sees the turn.
- The model's `crisis` tool, for cases the pattern does not catch.

A false stop costs one reading. A missed one is worse, so the screen is broad.

## Test

`test/live-e2e.js` runs a live session in headless Chrome. A fake microphone plays a WAV file. The test logs each table event and saves a screenshot when a card flips.

```
npm run dev                  # in one terminal
cd agent && npm run dev      # in a second terminal
CHROME=/path/to/chrome node test/live-e2e.js                 # a full reading
CHROME=/path/to/chrome WAV=./crisis.wav node test/live-e2e.js  # the crisis stop
```

Make the WAV files with `say` and `ffmpeg`. They are not in git.

The classic test plays `test/question.wav` into a fake microphone, holds space and saves a screenshot of each stage to `test/shots/`.

```
npm run dev            # in one terminal
CHROME=/path/to/chrome npm run test:e2e
```

## Card images

The cards are the 1909 Rider-Waite-Smith deck, which is in the public domain. The scans come from [metabismuth/tarot-json](https://github.com/metabismuth/tarot-json) (MIT).
