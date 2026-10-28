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
  name: "Live Translate",
  slug: "live-translate",
  scheme: "livetranslate",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: BG,
  ios: {
    bundleIdentifier: "com.livetranslate.app",
    supportsTablet: true,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.livetranslate.app",
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
    name: "Live Translate",
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
          "Live Translate uses the microphone to transcribe what you say so your listeners can read the translation.",
        speechRecognitionPermission: "Live Translate uses speech recognition to turn your speech into text for live translation.",
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
