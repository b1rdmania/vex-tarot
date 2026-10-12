# Plan

Party: 31 October 2026. Andy is in Oslo from 19 to 23 October.

## Done (updated 12 October)

- Live session on LiveKit Agents 1.9.2: Deepgram, Kimi K3 on OpenRouter, ElevenLabs.
- Five-card spread by default. The full Celtic Cross (10 cards) if the guest asks.
- Server card draw. Cards flip when Vex says their names.
- Crisis stop with two checks: a transcript screen and a model tool.
- The session ends after the verdict, after 30 seconds of silence, or at an enforced eight-minute cutoff.
- Laptop presentation: large opening mirror, featured current card, optional captions, visible connection status, and a 30-second photographic keepsake.
- Microphone failure cleanup, retry controls, startup/reconnection watchdogs, strict card announcements, and no guest speech in application logs.
- Deterministic agent/browser regression tests; paid live tests now assert outcomes.
- Cloudflare kiosk and Fly agent deployment completed before this update. The 12 October code changes still require deployment together.
- LiveAvatar face wired in. It is optional; with no key, Vex is voice only.
- The classic push-to-talk build is kept at `/classic/` as a fallback.

Earlier build tested headless: a full five-card reading with the Ella face, and the crisis stop. The 12 October update is covered by deterministic browser/agent tests; a new paid end-to-end run is still needed. Tested once with a real mic: the model wrote its tool calls as text, so the cards are now drawn before the session and flip from her speech. Still needs real-service verification: the Celtic Cross, a real microphone in a loud room, and visual inspection of the LiveAvatar face.

## Next, before the party

1. **Face test.** Done headless on 11 October with the public avatar Ella (Disinterested). Still to check: lip sync by eye, credit use per session, and the voice-only fallback when the avatar fails.
2. **Choose the face.** Andy, a friend or Charlie. That person records 2 minutes of continuous video (15 s listening, 90 s talking, 15 s listening) and a consent clip, in costume, in the room. Make an ElevenLabs voice clone from the same recording.
3. **LiveAvatar Essential ($99/month).** One custom avatar slot. About $0.09/minute in LITE mode. Sessions up to 20 minutes.
4. **Rewrite the persona for the chosen person** if it is not a woman in goth costume.
5. **Deploy the 12 October update** to the existing Fly agent and Cloudflare kiosk together, then smoke-test their shared card-announcement protocol.
6. **Room test** with a real mic, speakers and background noise. Tune the interruption and endpointing settings.
7. **Keepsake.** Email the reading and the cards after the session. Needs a Resend key and a sending domain.

## Costs for one party night

About 3 hours of sessions:

| Item | Cost |
| --- | --- |
| LiveAvatar | $99/month plan |
| ElevenLabs | Creator plan or higher |
| Deepgram and OpenRouter | a few dollars |
| LiveKit Cloud | free tier |
| Fly | a few dollars |

## To market (only if the party proves it)

Signals to watch at the party: second readings, people filming the screen, keepsake email opens.

The product is a hired act, not an app: a live AI reader with a real person's face, for events, brand activations and venues. Each client gets their own face, voice, persona and deck art. The code already separates these into settings (`VOICE_ID`, `LIVEAVATAR_AVATAR_ID`, `persona.js`).

What a sellable version needs:

- One persona file for each client, and a way to choose it per kiosk.
- Session recordings and clips that guests can share.
- Uptime and fallback for a venue network.
- A consent and likeness agreement for each face.
