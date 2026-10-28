import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { useI18n } from "@/i18n";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
export const googleSignInConfigured = !!WEB_CLIENT_ID;

declare global {
  interface Window {
    google?: any;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Web: Google's official "Sign in with Google" button (Google Identity Services). */
export function GoogleSignInButton({ onCredential, onError }: { onCredential: (idToken: string) => void; onError: (message: string) => void }) {
  const { lang, t } = useI18n();
  const container = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const handleCredential = useEffectEvent((credential?: string) =>
    credential ? onCredential(credential) : onError(t("auth.googleFailed")),
  );
  const handleLoadError = useEffectEvent(() => onError(t("auth.googleFailed")));

  useEffect(() => {
    if (!WEB_CLIENT_ID || !width) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !container.current) return;
        window.google.accounts.id.initialize({
          client_id: WEB_CLIENT_ID,
          callback: (resp: { credential?: string }) => handleCredential(resp.credential),
          ux_mode: "popup",
        });
        container.current.innerHTML = "";
        window.google.accounts.id.renderButton(container.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: Math.min(400, Math.round(width)),
          locale: lang,
        });
      })
      .catch(() => handleLoadError());
    return () => {
      cancelled = true;
    };
  }, [width, lang]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ alignItems: "center", minHeight: 44 }}>
      <div ref={container} />
    </View>
  );
}
