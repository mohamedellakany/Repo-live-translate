# Live Translate

Real-time speech translation for meetings, lectures and conversations.
A **speaker** talks (in Arabic by default, or one of 13 other languages), and any number of **listeners** read the translation live, in their own language, on their phone or browser.

- **Speakers** need an account. Their username is their **speaker ID**.
- **Listeners** need no account. They type the speaker ID (or scan the speaker's QR code, or open their link) and start reading. Listeners who sign in can reread the sessions they attended later.
- One codebase for **iOS, Android and Web** (Expo / React Native).

**Live app:** [app.192-18-128-201.sslip.io](https://app.192-18-128-201.sslip.io) · **API health:** [api.192-18-128-201.sslip.io/health](https://api.192-18-128-201.sslip.io/health)

```
┌───────────────┐  interim + final text  ┌───────────────────────────┐  source + translation  ┌───────────────┐
│ Speaker app   │ ─────────────────────▶ │ Server (Node / Socket.IO) │ ─────────────────────▶ │ Listener app  │
│ speech → text │      (WebSocket)       │ auth · rooms · translate  │      (WebSocket)       │ live captions │
└───────────────┘                        └───────────────────────────┘                        └───────────────┘
```

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [How "live" is achieved](#how-live-is-achieved)
- [Project layout](#project-layout)
- [Development](#development)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [API reference](#api-reference)

## Features

| Area | What you get |
| --- | --- |
| Speaking | 14 speaking languages, with Arabic as the default and a dialect picker for Arabic. The last choice is remembered on each device. |
| Listening | 14 reading languages, including Arabic. Listeners can show or hide the original text, change the font size and have the translation read aloud. |
| Private sessions | Optional PIN. Listeners who were waiting without the PIN are removed when the session starts. |
| History (speakers) | Every session is saved. Untitled sessions are named after their date (e.g. "Tuesday, October 28, 2026"). Speakers can share, delete, and choose whether listeners may revisit each session. |
| My sessions (listeners) | Signed-in listeners keep the sessions they attended and can reread them in their language. Guests are offered a free account when a session ends, and the session is added once they sign up. |
| AI summaries | Title, overview, key points, decisions and action items. Generated **automatically when a session ends**, and can be regenerated on demand. |
| Appearance | Dark (default) or Light. Tap the sun/moon button on the Home screen, or use the switch in Account. The choice is remembered on each device. |
| Interface | English and Arabic (right-to-left), selectable in the app. |

## Quick start

Requirements: **Node.js 22.13+**, and **Google Chrome, Edge or Safari** (Firefox has no speech recognition).

You need two terminals, one for the backend and one for the app:

```bash
# Terminal 1: backend
cd server
npm install
cp .env.example .env        # defaults work out of the box (free translation provider)
npm run dev                 # → http://localhost:4000

# Terminal 2: app
cd mobile
npm install
npx expo start --web --port 8082
```

Then open http://localhost:8082:

1. **Create speaker account** → **Go live** → allow the microphone → start speaking.
2. In another tab, window or device, enter your speaker ID and read the translation live.
   You can also open `http://localhost:8082/listen/<username>` directly or scan the QR code.

Accounts and session history are stored in the local SQLite database, so they survive restarts.

> **Testing "My sessions":** the listener must be a **different account** from the speaker. Tabs in the same browser share one login, so use a private/incognito window or another browser for the listener.

> **Tip:** if you turn on **Read aloud**, use headphones or a second device for the listener so the speech synthesis isn't picked up by the microphone.

## How "live" is achieved

| Stage | Technique |
| --- | --- |
| Speech recognition | On-device/OS recognizers (iOS Speech, Android SpeechRecognizer, Chrome/Edge/Safari Web Speech) with **interim results**, so words appear while you're still talking. Recognizers auto-restart when the OS stops them. |
| Transport | Socket.IO over pure WebSocket (no long-polling), compression off for tiny packets, ~100 ms client throttle on interim text. |
| Translation | Interim text uses **latest-wins coalescing**: at most one request per sentence per language is in flight, and stale results are never shown, so there's no backlog. Finished sentences get a final translation that uses the previous sentences as context. An LRU cache handles repeated text. Listeners reading the speaker's own language get the original text with no translation request. |
| Resilience | Speaker reconnects resume the same session (20 s grace). Sentences spoken while offline are queued and sent on reconnect. Listeners auto-rejoin, and late joiners receive the transcript so far. |

Typical end-to-end latency: the spoken text appears immediately, and the translation follows ~150–600 ms later depending on the translation provider.

## Project layout

```
server/              Node.js + TypeScript backend
  src/realtime.ts      Socket.IO rooms & translation pipeline (the core)
  src/translation/     Pluggable providers: free | google | deepl | claude
  src/summary.ts       AI summaries (Gemini or Claude), automatic when a session ends
  src/routes/          REST: auth, speaker lookup, session history, listener library
  src/db.ts            SQLite (built into Node, no native deps) with automatic migrations
  test/                Integration tests
mobile/              Expo (React Native) app: iOS, Android, Web
  src/app/             Screens (Expo Router): home, login, register, speak, listen/[username],
                       history (speakers), library (listeners' "My sessions"), account
  src/hooks/           useSpeechCapture (mic → text), useCaptions (live caption stream)
  src/components/      UI kit, caption feed, QR share card, summary card, theme picker
  src/theme.tsx        Dark and light palettes, theme preference, makeStyles()
deploy/              Docker Compose, Caddy and VM deploy scripts
```

## Development

### Tests and checks

```bash
cd server && npm test             # end-to-end: auth, live room, captions, history, listener library
cd server && npm run typecheck
cd mobile && npx tsc --noEmit && npx expo lint && npx expo-doctor
```

### Test on your phone (same Wi-Fi)

Native speech recognition needs a **development build** (Expo Go doesn't include the speech module):

```bash
cd mobile
npx expo run:ios                  # requires Xcode
npx expo run:android              # requires Android Studio
npx eas-cli@latest build --profile development   # or build in the cloud
```

The app automatically talks to the backend on the computer running Expo (same IP, port 4000).
Listeners on a phone can also open the web URL `http://<your-computer-ip>:8082`.

> **Note:** browsers only allow the **microphone** on `https://` or `localhost`, so a phone *speaking* through the browser needs HTTPS (see [Deployment](#deployment)).

### Styling and themes

Colors come from the active theme, so styles are written with `makeStyles` instead of `StyleSheet.create`:

```tsx
import { makeStyles, useTheme } from "@/theme";

function Example() {
  const { colors } = useTheme();   // for inline colors (icons, etc.)
  const styles = useStyles();
  return <Text style={styles.title}>Hello</Text>;
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 18 },
}));
```

### Adding languages

1. Add the language to `server/src/languages.ts` and `mobile/src/constants/languages.ts` (keep them in sync).
2. Add its code to `SOURCE_LANGUAGES` (speakers) and/or `TARGET_LANGUAGES` (listeners). The pickers on the speak and listen screens pick it up automatically.
3. Check that your translation provider supports it.

## Configuration

Settings live in `server/.env` for local development and `server/.env.production` for the live server. Both files are gitignored; `server/.env.example` lists every option.

### Translation providers

Set `TRANSLATION_PROVIDER`:

| Provider | Key needed | Latency | Notes |
| --- | --- | --- | --- |
| `free` (default) | none | ~60–500 ms | Google's public web endpoint. **Development only**: unofficial and rate-limited. |
| `google` | `GOOGLE_TRANSLATE_API_KEY` | ~100–200 ms | **Recommended for production.** Google Cloud Translation v2. |
| `deepl` | `DEEPL_API_KEY` | ~200–400 ms | Excellent quality, uses previous sentences as context. |
| `claude` | `ANTHROPIC_API_KEY` | ~1–2 s | Best with dialects, idioms and unpunctuated speech. Model via `CLAUDE_MODEL` (default `claude-opus-5-5`, low effort). Server-side refusal fallbacks enabled. For lower latency and cost, set `CLAUDE_MODEL=claude-haiku-5-5`. |

### AI summaries

Summaries are written automatically when a session ends (after its last sentences finish translating), so they're usually ready by the time the speaker opens **History**. Speakers can also regenerate them on demand. Signed-in listeners see the summary in **My sessions**.

| Provider | Settings | Notes |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` (from [Google AI Studio](https://aistudio.google.com/apikey)), optional `GEMINI_MODEL` (default `gemini-3.8-flash`) | Requests use `store: false`, so Google doesn't keep the transcript after answering. Low thinking level for speed. |
| Claude | `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL` | Low effort for speed. |

- If both keys are set, Gemini is used unless you set `SUMMARY_PROVIDER=claude`. With no key, summaries are turned off and the button is hidden.
- `AUTO_SUMMARY=false` turns off automatic summaries, so they're only generated when a speaker asks (one AI call per session otherwise).

## Deployment

### Updating the live app (Oracle VM)

The app is hosted on an Oracle Cloud VM (`ubuntu@192.18.128.201`) and deployed with `deploy/deploy.sh`. After every code change:

**1. Test locally.** Run the [Quick start](#quick-start) commands, check your change at http://localhost:8082, and run the [tests and checks](#tests-and-checks).

**2. Commit and push to GitHub.**

```bash
git add <files>
git commit -m "Describe what you changed"
git push
```

The deploy uploads the files on your Mac (not from GitHub), so this step is for history and rollback.

**3. Deploy** from the project root (takes about 3 minutes):

```bash
./deploy/deploy.sh ubuntu@192.18.128.201 ~/.ssh/oracle-live-translate.key
```

It rebuilds the web app, uploads the server code and restarts the containers. When it prints **Done**, the new version is live.
The database (accounts, history) is kept between deploys, and any database changes are applied automatically when the server starts. The site is down for a few seconds while the server restarts.

**4. Check it online.**

- Web app: https://app.192-18-128-201.sslip.io (press **Cmd + Shift + R** to skip the browser cache)
- API health: https://api.192-18-128-201.sslip.io/health should return `{"status":"ok",...}`

#### Special cases

- **Changing server settings** (API keys, email, translation provider, `AUTO_SUMMARY`): edit `server/.env.production`, not `server/.env`, then deploy again.
- **Rolling back a bad deploy:**

  ```bash
  git log --oneline        # find the last good commit, e.g. a1b2c3d
  git checkout a1b2c3d     # load that version
  ./deploy/deploy.sh ubuntu@192.18.128.201 ~/.ssh/oracle-live-translate.key
  git checkout main        # return to your latest code afterwards
  ```

  Database changes are not undone by a rollback. Older code ignores the new tables and columns, but take a backup first if in doubt (see `deploy/backup-cron.example`).

- **Viewing server logs:**

  ```bash
  ssh -i ~/.ssh/oracle-live-translate.key ubuntu@192.18.128.201 \
    'cd /opt/live-translate/deploy && docker compose logs server --tail 50'
  ```

- **Store apps (iOS/Android):** this deploy only updates the server and the web app. Installed store apps need a new EAS build (or `eas update` for JavaScript-only changes once `expo-updates` is added).
- **New VM:** run the same deploy command. On a fresh VM it also installs Docker, adds swap and opens the firewall (`deploy/setup-vm.sh`). The VM's network security list must allow TCP ports 80 and 443.

### Other hosts

#### Backend

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

#### Web app

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://api.your-domain.com \
EXPO_PUBLIC_WEB_URL=https://app.your-domain.com \
npx expo export --platform web
```

Upload `mobile/dist` to Netlify, Vercel or S3 + CloudFront, and configure an SPA fallback to `index.html`.

### App Store & Google Play

1. Change `ios.bundleIdentifier` / `android.package` in `mobile/app.config.ts` (currently `com.livetranslate.app`), and replace the icons in `mobile/assets/`.
2. Set your production API URL in `mobile/eas.json` (`EXPO_PUBLIC_API_URL`, and `EXPO_PUBLIC_WEB_URL` for share links).
3. Build and submit:

   ```bash
   cd mobile
   npx eas-cli@latest login
   npx eas-cli@latest build --platform all --profile production
   npx eas-cli@latest submit --platform ios       # needs an Apple Developer account
   npx eas-cli@latest submit --platform android   # needs a Google Play Console account
   ```

4. Store listing: microphone and speech-recognition permission texts are already set in `app.config.ts`. You'll also need a privacy policy URL; the in-app policy is at `/privacy` on the web app (speech is processed by the OS speech service and the translation provider, transcripts are stored for the speaker's history and, if the speaker allows it, for listeners who attended).

## API reference

REST (`/api`). Routes marked 🔒 need `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register`, `/auth/login` | Create an account / sign in |
| `GET`, `PATCH`, `DELETE` | `/auth/me` 🔒 | Current user, update display name, delete account |
| `GET` | `/speakers/:username` | Public speaker info and live status |
| `GET` | `/sessions` 🔒 | The speaker's sessions |
| `GET`, `DELETE` | `/sessions/:id` 🔒 | Transcript and summary / delete a session |
| `PATCH` | `/sessions/:id` 🔒 | `{ allowRevisit }`: let listeners who attended reopen it |
| `POST` | `/sessions/:id/summary` 🔒 | Generate or regenerate the AI summary |
| `GET` | `/library` 🔒 | The listener's "My sessions" |
| `POST` | `/library` 🔒 | `{ sessionId, lang }`: add a session followed before signing in |
| `GET`, `DELETE` | `/library/:id` 🔒 | Transcript in the listener's language / remove from their list |
| `GET` | `/languages`, `/config` | Supported languages, enabled features |

The health check is at `GET /health` (outside `/api`). Socket events are documented at the top of `server/src/realtime.ts`.
