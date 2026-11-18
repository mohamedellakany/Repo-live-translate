#!/usr/bin/env bash
# Build the iPhone app on this Mac and install it on a connected iPhone (free Apple account: works for 7 days).
#
# Usage (from mobile/):   npm run build:ios
#
# Options (environment variables):
#   API_URL     backend the app talks to       (default: the live server)
#   WEB_URL     web app used for share links   (default: the live web app)
#   DEVICE      iPhone to install on (UDID from `xcrun devicectl list devices`; default: the first connected iPhone)
#   TEAM        Apple development team ID      (default: K5S4N28GQC)
#   NO_INSTALL=1  only build
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
# Without these, a release build can't find the server (it would look for one on the phone itself).
export EXPO_PUBLIC_API_URL="${API_URL:-https://api.lisancast.com}"
export EXPO_PUBLIC_WEB_URL="${WEB_URL:-https://app.lisancast.com}"
TEAM="${TEAM:-K5S4N28GQC}"
BUILD_DIR="${TMPDIR:-/tmp}/lisancast-ios-build"

cd "$MOBILE"

echo "==> Generating the native iOS project"
# Prebuild rewrites the "android"/"ios" npm scripts; keep package.json exactly as it was.
saved="$(mktemp)"
cp package.json "$saved"
npx expo prebuild --platform ios --clean
cp "$saved" package.json
rm -f "$saved"

echo "==> Building for $EXPO_PUBLIC_API_URL (a few minutes)"
(cd ios && xcodebuild -workspace LisanCast.xcworkspace -scheme LisanCast -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath "$BUILD_DIR" \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates -quiet)
APP="$BUILD_DIR/Build/Products/Release-iphoneos/LisanCast.app"

# Guard against the mistake this script exists to prevent.
grep -aq "${EXPO_PUBLIC_API_URL#https://}" "$APP/main.jsbundle" || { echo "The build doesn't contain $EXPO_PUBLIC_API_URL"; exit 1; }

[ "${NO_INSTALL:-0}" = 1 ] && { echo "Built: $APP"; exit 0; }
DEVICE="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /available/ && !/simulated/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}"
[ -n "$DEVICE" ] || { echo "No connected iPhone found. Built: $APP"; exit 1; }
echo "==> Installing on $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP" >/dev/null
echo "Done: LisanCast is installed on the iPhone."
