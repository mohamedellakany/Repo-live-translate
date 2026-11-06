#!/usr/bin/env bash
# Build an installable Android APK on this Mac and copy it to the APK folder, replacing the previous one.
# The APK is a release build signed with the debug key: fine for testing on phones, not for the Play Store.
#
# Usage (from mobile/):   npm run build:apk        or   ./scripts/build-apk.sh
#
# Options (environment variables):
#   APK_DIR   folder for the APK            (default: ~/Downloads/Apps)
#   API_URL   backend the app talks to      (default: the live server)
#   WEB_URL   web app used for share links  (default: the live web app)
#   CLEAN=1   regenerate the native android/ project first (needed after changing app.config.ts)
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
APK_DIR="${APK_DIR:-$HOME/Downloads/Apps}"
APK_NAME="live-translate.apk"
export EXPO_PUBLIC_API_URL="${API_URL:-https://api.192-18-128-201.sslip.io}"
export EXPO_PUBLIC_WEB_URL="${WEB_URL:-https://app.192-18-128-201.sslip.io}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

# ---- Tools ----
if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
             /Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home; do
    if [ -x "$jdk/bin/java" ]; then export JAVA_HOME="$jdk"; break; fi
  done
fi
[ -n "${JAVA_HOME:-}" ] || { echo "Java 17 not found. Install it with: brew install openjdk@17"; exit 1; }
[ -d "$ANDROID_HOME" ] || { echo "Android SDK not found at $ANDROID_HOME (install Android Studio or the SDK command-line tools)"; exit 1; }

cd "$MOBILE"

# ---- 1. Native project (first run, or CLEAN=1) ----
if [ "${CLEAN:-0}" = 1 ] || [ ! -d android ]; then
  echo "==> Generating the native Android project"
  # Prebuild rewrites the "android"/"ios" npm scripts; keep package.json exactly as it was.
  saved="$(mktemp)"
  cp package.json "$saved"
  if [ "${CLEAN:-0}" = 1 ]; then
    npx expo prebuild --platform android --no-install --clean
  else
    npx expo prebuild --platform android --no-install
  fi
  cp "$saved" package.json
  rm -f "$saved"
fi

# ---- 2. Build ----
echo "==> Building the APK for $EXPO_PUBLIC_API_URL (a few minutes; the first build takes longer)"
(cd android && NODE_ENV=production ./gradlew assembleRelease --console=plain -q)

# ---- 3. Copy ----
mkdir -p "$APK_DIR"
cp android/app/build/outputs/apk/release/app-release.apk "$APK_DIR/$APK_NAME"

echo
echo "Done: $APK_DIR/$APK_NAME"
echo "Install on a USB-connected phone:"
echo "  $ANDROID_HOME/platform-tools/adb install -r \"$APK_DIR/$APK_NAME\""
