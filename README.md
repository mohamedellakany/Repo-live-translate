# Live Translate

Real-time speech translation for meetings, lectures and conversations.
A **speaker** talks in Arabic; any number of **listeners** read the English translation live on their phone or browser.

- **Speakers** need an account. Their username is their **speaker ID**.
- **Listeners** need no account. They type the speaker ID (or scan the speaker's QR code / open their link) and start reading.
- One codebase for **iOS, Android and Web** (Expo / React Native).

```
┌──────────────┐  interim + final text   ┌──────────────────────────┐   source + translation   ┌──────────────┐
│ Speaker app  │ ──────────────────────▶ │  Server (Node/Socket.IO) │ ───────────────────────▶ │ Listener app │
│ speech → text│      (WebSocket)        │  auth · rooms · translate│       (WebSocket)        │  live captions│
└──────────────┘                         └──────────────────────────┘                          └──────────────┘
```

## How "live" is achieved

| Stage | Technique |
| --- | --- |
| Speech recognition | On-device/OS recognizers (iOS Speech, Android SpeechRecognizer, Chrome/Edge/Safari Web Speech) with **interim results**, so words appear while you're still talking. Recognizers auto-restart when the OS stops them. |
| Transport | Socket.IO over pure WebSocket (no long-polling), compression off for tiny packets, ~100 ms client throttle on interim text. |
| Translation | Interim text is translated with **latest-wins coalescing**: at most one request per sentence per language is in flight, and stale results are never shown, so there's no backlog. Finished sentences get a final translation that uses the previous sentences as context. LRU cache for repeated text. |
| Resilience | Speaker reconnects resume the same session (20 s grace). Sentences spoken while offline are queued and sent on reconnect. Listeners auto-rejoin and late joiners receive the transcript so far. |

Typical end-to-end latency: the Arabic text appears immediately, and the English follows ~150–600 ms later depending on the translation provider.

## Project layout

```
server/            Node.js + TypeScript backend
  src/realtime.ts    Socket.IO rooms & translation pipeline (the core)
  src/translation/   Pluggable providers: free | google | deepl | claude
  src/routes/        REST: auth, speaker lookup, session history
  src/db.ts          SQLite (built into Node, no native deps)
  test/              Integration tests
mobile/            Expo (React Native) app: iOS, Android, Web
  src/app/           Screens (Expo Router): home, login, register, speak, listen/[username], history, account
  src/hooks/         useSpeechCapture (mic → text), useCaptions (live caption stream)
  src/components/    UI kit, caption feed, QR share card
```

## Run it locally (browser)

Requirements: **Node.js 22.13+**, and **Google Chrome, Edge or Safari** (Firefox has no speech recognition).

```bash
# 1. Backend
cd server
npm install
cp .env.example .env        # defaults work out of the box (free translation provider)
npm run dev                 # → http://localhost:4000

# 2. App (new terminal)
cd mobile
npm install
npx expo start --web        # press "w", or open the printed URL (port 8081 by default)
```

Then:

1. Open the app → **Create speaker account** → **Go live** → allow the microphone → speak Arabic.
2. Open the same URL in another tab, window or device → enter your speaker ID → read the English live.
   You can also open `http://localhost:8081/listen/<username>` directly or scan the QR code.

> Tip: use headphones or a second device for the listener tab if you turn on **Read aloud**, so the speech synthesis isn't picked up by the microphone.

### Test on your phone (same Wi-Fi)

Native speech recognition needs a **development build** (Expo Go doesn't include the speech module):

```bash
cd mobile
npx expo run:ios        # requires Xcode,  or:
npx expo run:android    # requires Android Studio
# or build in the cloud:  npx eas-cli@latest build --profile development
```

The app automatically talks to the backend on the computer running Expo (same IP, port 4000).
Listeners on a phone can also simply open the web URL `http://<your-computer-ip>:8081`. Note that browsers only allow the **microphone** on `https://` or `localhost`, so a phone *speaking* through the browser needs HTTPS (see Deploy).

### Tests & checks

```bash
cd server && npm test           # end-to-end: auth, live room, captions, history
cd server && npm run typecheck
cd mobile && npx tsc --noEmit && npx expo-doctor
```

## Translation providers

Set `TRANSLATION_PROVIDER` in `server/.env`:

| Provider | Key needed | Latency | Notes |
| --- | --- | --- | --- |
| `free` (default) | none | ~60–500 ms | Google's public web endpoint. **Development only**: unofficial and rate-limited. |
| `google` | `GOOGLE_TRANSLATE_API_KEY` | ~100–200 ms | **Recommended for production.** Google Cloud Translation v2. |
| `deepl` | `DEEPL_API_KEY` | ~200–400 ms | Excellent quality, uses previous sentences as context. |
| `claude` | `ANTHROPIC_API_KEY` | ~1–2 s | Best with dialects, idioms and unpunctuated speech. Model via `CLAUDE_MODEL` (default `claude-opus-5-5`, low effort). Server-side refusal fallbacks enabled. For lower latency and cost, set `CLAUDE_MODEL=claude-haiku-5-5`. |

## Adding languages later

1. Add the language to `server/src/languages.ts` and `mobile/src/constants/languages.ts`.
2. Add its code to `SOURCE_LANGUAGES` (speakers) and/or `TARGET_LANGUAGES` (listeners).
3. Add a language picker on the speak/listen screens (the protocol already carries `sourceLang` / `lang`, and the server already translates per language only for languages that have listeners).

## Deploy

### Backend

Any host that supports WebSockets (Render, Railway, Fly.io, a VPS…):

```bash
cd server
docker build -t live-translate-server .
docker run -p 4000:4000 -v lt-data:/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e CORS_ORIGINS=https://app.your-domain.com \
  -e TRANSLATION_PROVIDER=google -e GOOGLE_TRANSLATE_API_KEY=... \
  live-translate-server
```

Put it behind HTTPS (`https://api.your-domain.com`). The server refuses to start in production with the default `JWT_SECRET`.
SQLite is fine for a single instance. To run several instances, move to Postgres and add the Socket.IO Redis adapter.

### Web app

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://api.your-domain.com EXPO_PUBLIC_WEB_URL=https://app.your-domain.com npx expo export --platform web
# upload mobile/dist to Netlify / Vercel / S3+CloudFront (configure SPA fallback to index.html)
```

### App Store & Google Play

1. Change `ios.bundleIdentifier` / `android.package` in `mobile/app.json` (currently `com.livetranslate.app`), and replace the icons in `mobile/assets/`.
2. Set your production API URL in `mobile/eas.json` (`EXPO_PUBLIC_API_URL`, and `EXPO_PUBLIC_WEB_URL` for share links).
3. Build and submit:
   ```bash
   cd mobile
   npx eas-cli@latest login
   npx eas-cli@latest build --platform all --profile production
   npx eas-cli@latest submit --platform ios       # needs an Apple Developer account
   npx eas-cli@latest submit --platform android   # needs a Google Play Console account
   ```
4. Store listing: microphone and speech-recognition permission texts are already set in `app.json`. You'll also need a privacy policy URL (speech is processed by the OS speech service and the translation provider; transcripts are stored for the speaker's history).

## API reference (summary)

REST (`/api`): `POST /auth/register`, `POST /auth/login`, `GET|PATCH /auth/me`, `GET /speakers/:username`, `GET /sessions`, `GET|DELETE /sessions/:id`, `GET /languages`, `GET /health`.

Socket events are documented at the top of `server/src/realtime.ts`.

You need two terminals, one for the backend and one for the app.

# Terminal 1 (Backend)
cd ~/Downloads/Translation/server && npm run dev

# Terminal 2 (Frontend)
cd ~/Downloads/Translation/mobile && npx expo start --web --port 8082

Then open http://localhost:8082. The demo / password123 account and any accounts you create are still saved.

demo / password123