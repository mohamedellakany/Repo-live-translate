import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Dynamic Expo config. Optional integrations switch on via environment variables (see .env.example):
 *  - Google sign-in on iOS/Android needs EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (its reversed form is the iOS URL scheme).
 */
const BG = "#0B1020";
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const iosUrlScheme = iosClientId ? `com.googleusercontent.apps.${iosClientId.replace(".apps.googleusercontent.com", "")}` : null;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "LisanCast",
  slug: "live-translate",
  scheme: "livetranslate",
  version: "1.0.2",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // The app sets light/dark itself at runtime (Appearance.setColorScheme) from the in-app theme switch.
  userInterfaceStyle: "automatic",
  backgroundColor: BG,
  ios: {
    // "com.livetranslate.app" is registered to another Apple developer, so iOS uses a unique identifier.
    bundleIdentifier: "com.ellakany.livetranslate",
    supportsTablet: true,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    // Permanent once published on Google Play.
    package: "com.lisancast.app",
    // Must increase with every Google Play upload; scripts/build-aab.sh sets it (default: the git commit count).
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    adaptiveIcon: {
      backgroundColor: BG,
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["android.permission.RECORD_AUDIO"],
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
    output: "single",
    name: "LisanCast",
    themeColor: BG,
    backgroundColor: BG,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "LisanCast uses the microphone to transcribe what you say so your listeners can read the translation.",
        speechRecognitionPermission: "LisanCast uses speech recognition to turn your speech into text for live translation.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox", "com.google.android.as"],
      },
    ],
    "expo-font",
    ["expo-localization", { supportsRTL: true }],
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 180, backgroundColor: BG, resizeMode: "contain" },
    ],
    ...(iosUrlScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme }] as [string, unknown]] : []),
  ],
  experiments: { typedRoutes: false },
});
