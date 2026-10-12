# Vex

Vex is a goth tarot reader for a Halloween party. A guest sits down, presses space and talks to her. Vex asks what they want to know, mocks the question, deals five cards and reads them one at a time. The guest can talk back at any point. A session takes about three minutes.

There are two versions:

- **Live** (`/`). A real-time voice session through LiveKit. A video face from HeyGen LiveAvatar is optional.
- **Classic** (`/classic/`). The first build: push-to-talk, three cards, one question. It needs no LiveKit, so it is the fallback.

## How a live session works

1. The guest presses space. The kiosk asks `/api/token` for a LiveKit token. The token puts the `vex` agent in a new room.
2. The agent worker (`agent/agent.js`) joins. Deepgram transcribes the guest, Kimi K3 (on OpenRouter) writes Vex's lines and ElevenLabs speaks them. The kiosk draws Vex as a cartoon whose mouth follows her voice. The LiveAvatar face is off unless `VEX_AVATAR=1` and `LIVEAVATAR_API_KEY` are both set.
3. Before she speaks, the worker draws ten cards with a crypto random number generator and puts them in her instructions. The model does not choose them. The kiosk gets the same list.
4. When Vex has the question, the model calls `deal` with the spread (five cards, or the Celtic Cross if asked). The kiosk lays the cards face down.
5. She announces that the cards are on the table, then reads them in order. A card flips only on its full name plus orientation, such as “The Sun, upright.” The kiosk enlarges the active card beside her mirror. If `deal` fails, the explicit table announcement can start the short spread or Celtic Cross after at least four guest turns (or a request to hurry). Casual card references during the opening do nothing.
6. After the final uninterrupted card turn, the last sentence becomes the on-screen verdict. The worker deletes the room. The kiosk keeps the spread and verdict for 30 seconds for a photograph, then resets. “Next guest” resets it sooner.

A session also ends if the guest is silent for 30 seconds. Vex gets a wrap-up cue at about 7 minutes 15 seconds; an independent timer closes the session at 8 minutes even if she does not comply. Connection and reconnection attempts fail visibly after 35 seconds. A denied microphone closes the joined room before allowing a retry.

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
   VEX_AVATAR=0             # 1 = use the LiveAvatar face below instead of voice only
   LIVEAVATAR_API_KEY=...   # optional; only used when VEX_AVATAR=1
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
| Escape / End reading | End the session now. |
| Captions on/off | Toggle spoken captions; the preference is remembered on this browser. |
| Next guest | Clear the finished reading immediately. |
| `d` | Show or hide the debug log. |

## Settings

The agent reads these from `agent/.env`.

| Name | Default | What it changes |
| --- | --- | --- |
| `VOICE_ID` | `X6VIT9ZXy5Nr7EmuLOGz` (Daria) | Vex's ElevenLabs voice. Use a cloned voice for a real person. |
| `TTS_SPEED` | `1.1` | Speaking speed, 0.7 to 1.2. |
| `LLM_MODEL` | `moonshotai/kimi-k3` | The model on OpenRouter. Reasoning is off. |
| `TTS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs voice model. |
| `VEX_MAX_SESSION_S` | `480` | Hard session limit in seconds, including avatar startup; the wrap-up cue is 45 seconds earlier once the session starts. |
| `VEX_MIN_GUEST_TURNS` | `4` | Opening turns before dealing; a request to hurry bypasses this gate. |

The persona, the spreads and the crisis screen are in `agent/persona.js`.

## Safety

If a guest talks about self-harm, hopelessness, a death, abuse or a health scare, Vex stops the reading. She says one kind line and gives the Samaritans number. The line is fixed text in `agent/persona.js`, not model output.

Two checks can stop a session:

- A pattern screen on every transcript, including words said while Vex is talking. It runs before the model sees the turn.
- The model's `crisis` tool, for cases the pattern does not catch.

A false stop costs one reading. A missed one is worse, so the screen is broad. The crisis message stays visible until the host selects “Next guest”; it does not automatically reset.

Application logs contain turn roles and operational events, not guest transcripts or readings. Local development uses info-level logging. LiveKit session recording is disabled. Speech and language providers still process session content; these settings do not establish their retention policies.

## Test

Run `npm test` for deterministic agent and browser tests. These use fake services, need no keys, and make no paid API calls. Coverage includes speech gating, five- and ten-card completion, interrupted final cards, crisis stops, the hard cutoff, microphone denial, missing agents, recovery, captions, and laptop/mobile layout. Chrome is detected on macOS; elsewhere set `CHROME` or install Playwright's browser.

`test/live-e2e.js` is the separate **paid integration test**. It requires the kiosk and agent running and a WAV microphone fixture. It fails on missing cards, missing verdict/reset, page errors, failed startup, or timeout. It saves screenshots under `test/shots/`.

```
npm run dev                  # kiosk, terminal one
cd agent && npm run dev       # worker, terminal two; heed the Fly warning below
npm run test:live
SCENARIO=crisis WAV=./crisis.wav npm run test:live
EXPECT_CARDS=10 WAV=./celtic.wav npm run test:live
SCENARIO=mic-denied npm run test:live
SCENARIO=agent-unavailable npm run test:live # requires no worker registered for this test
```

Make the WAV files with `say` and `ffmpeg`. A normal reading fixture must answer the introduction across at least four turns, or explicitly ask “just read the cards”. A Celtic Cross fixture must request that spread. Test audio is not committed. Never stop a shared production worker just to run the unavailable-agent test; use an isolated test environment.

The classic test plays `test/question.wav` into a fake microphone, holds space and saves a screenshot of each stage to `test/shots/`.

```
npm run dev            # in one terminal
CHROME=/path/to/chrome npm run test:e2e
```

## Card images

The cards are the 1909 Rider-Waite-Smith deck, which is in the public domain. The scans come from [metabismuth/tarot-json](https://github.com/metabismuth/tarot-json) (MIT).

## Test deploy

The kiosk runs on Cloudflare Workers at https://vex-tarot.andy-ff7.workers.dev. Deploy with `npx wrangler deploy`. Secrets are the keys in `.dev.vars`, uploaded with `wrangler secret bulk`.

Every API call spends money, so the API needs `ACCESS_CODE`. Share the link as `/?code=...`. The kiosk keeps the code for reloads.

The agent worker runs on Fly as `vex-agent` (one machine in London, always on). Deploy with `fly deploy -c fly.agent.toml`. Its keys are Fly secrets, imported from `agent/.env`. It has no public port: it connects out to LiveKit Cloud, which sends it each session.

To work on the agent locally, run `cd agent && npm run dev`. LiveKit sends sessions to any worker registered as `vex`, so stop the Fly machine first (`fly scale count 0 -c fly.agent.toml`), or the two will share sessions.


## Laptop presentation

Use a quiet corner with one seated guest. The opening keeps the mirror prominent; once cards are dealt, the current card gets the largest artwork and the full spread remains underneath. When video is unavailable, the dark mirror responds to Vex's audio. Visible status text tells the guest when to speak. Captions are optional and can help in a noisy room. The final spread and verdict are held for a photograph.

The local regression suite checks simulated sessions, not real microphone quality, avatar lip sync, or provider availability. Those still need a room rehearsal before the party.
