#!/usr/bin/env bash
# Build the signed Android App Bundle (.aab) to upload to Google Play.
#
# Usage (from mobile/):   npm run build:aab
#
# Needs the upload key in ~/.lisancast/ (upload-keystore.jks + upload-key.properties). Keep both backed up:
# Google Play only accepts updates signed with this key (a lost key can be reset through Play Console support).
#
# Options (environment variables):
#   VERSION_CODE  Play version code; must be higher than the last upload (default: the git commit count)
#   API_URL / WEB_URL   as in build-apk.sh (default: the live server)
#   OUT_DIR       where to save the .aab (default: ~/Downloads/Apps)
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
KEY_PROPS="${KEY_PROPS:-$HOME/.lisancast/upload-key.properties}"
OUT_DIR="${OUT_DIR:-$HOME/Downloads/Apps}"
[ -f "$KEY_PROPS" ] || { echo "Upload key settings not found: $KEY_PROPS"; exit 1; }
# shellcheck disable=SC1090
. "$KEY_PROPS"

export EXPO_PUBLIC_API_URL="${API_URL:-https://api.lisancast.com}"
export EXPO_PUBLIC_WEB_URL="${WEB_URL:-https://app.lisancast.com}"
export ANDROID_VERSION_CODE="${VERSION_CODE:-$(git -C "$MOBILE" rev-list --count HEAD)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home /Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home; do
    if [ -x "$jdk/bin/java" ]; then export JAVA_HOME="$jdk"; break; fi
  done
fi
[ -n "${JAVA_HOME:-}" ] || { echo "Java 17 not found. Install it with: brew install openjdk@17"; exit 1; }

cd "$MOBILE"
VERSION_NAME="$(sed -nE 's/^  version: "([^"]+)",.*/\1/p' app.config.ts)"

# Always regenerate the native project so the package name, version code and settings match app.config.ts.
echo "==> Generating the native Android project"
saved="$(mktemp)"; cp package.json "$saved"
npx expo prebuild --platform android --no-install --clean
cp "$saved" package.json; rm -f "$saved"

echo "==> Building the app bundle (version code $ANDROID_VERSION_CODE) for $EXPO_PUBLIC_API_URL"
# Sign with the upload key without writing it into the (generated) build.gradle.
(cd android && NODE_ENV=production ./gradlew bundleRelease --console=plain -q \
  -Pandroid.injected.signing.store.file="$LISANCAST_UPLOAD_STORE_FILE" \
  -Pandroid.injected.signing.store.password="$LISANCAST_UPLOAD_STORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$LISANCAST_UPLOAD_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$LISANCAST_UPLOAD_KEY_PASSWORD")

AAB="$OUT_DIR/lisancast-$VERSION_NAME-$ANDROID_VERSION_CODE.aab"
mkdir -p "$OUT_DIR"
cp android/app/build/outputs/bundle/release/app-release.aab "$AAB"

# Refuse to hand over a bundle signed with anything but the upload key.
SIGNER="$("$JAVA_HOME/bin/keytool" -printcert -jarfile "$AAB" 2>/dev/null | awk '/SHA256:/ {print $2; exit}')"
EXPECTED="$("$JAVA_HOME/bin/keytool" -list -v -keystore "$LISANCAST_UPLOAD_STORE_FILE" -storepass "$LISANCAST_UPLOAD_STORE_PASSWORD" 2>/dev/null | awk '/SHA256:/ {print $2; exit}')"
[ -n "$SIGNER" ] && [ "$SIGNER" = "$EXPECTED" ] || { echo "The bundle isn't signed with the upload key (got: ${SIGNER:-none})"; exit 1; }

echo
echo "Done: $AAB"
echo "  package com.lisancast.app · version $VERSION_NAME ($ANDROID_VERSION_CODE) · signed with the upload key"
echo "Upload it in Play Console → Test and release → (Internal / Closed testing) → Create new release."
