import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import type { CaptionLine } from "@/hooks/useCaptions";
import { useI18n } from "@/i18n";
import { colors, radius, spacing } from "@/theme";

interface Props {
  lines: CaptionLine[];
  /** "listener": translation first. "speaker": what you said first, translation preview below. */
  mode: "listener" | "speaker";
  showOriginal?: boolean;
  fontScale?: number;
  /** Writing direction of the translation language. */
  translationRtl?: boolean;
  empty?: ReactNode;
}

const NEAR_BOTTOM_PX = 80;

export function CaptionFeed({ lines, mode, showOriginal = true, fontScale = 1, translationRtl = false, empty }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM_PX;
    if (atBottom !== followingRef.current) {
      followingRef.current = atBottom;
      setFollowing(atBottom);
    }
  }, []);

  const scrollToEnd = useCallback((animated = true) => scrollRef.current?.scrollToEnd({ animated }), []);

  useEffect(() => {
    if (followingRef.current) setTimeout(() => scrollToEnd(true), 0);
  }, [lines, scrollToEnd]);

  if (lines.length === 0) return <View style={styles.emptyWrap}>{empty}</View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onContentSizeChange={() => followingRef.current && scrollToEnd(false)}
      >
        {lines.map((line) => (
          <Line
            key={line.seq}
            line={line}
            mode={mode}
            showOriginal={showOriginal}
            fontScale={fontScale}
            translationRtl={translationRtl}
            unavailable={t("captions.unavailable")}
          />
        ))}
      </ScrollView>
      {!following && (
        <Pressable
          style={styles.jump}
          accessibilityRole="button"
          onPress={() => {
            followingRef.current = true;
            setFollowing(true);
            scrollToEnd(true);
          }}
        >
          <Ionicons name="arrow-down" size={16} color="#fff" />
          <Text style={styles.jumpText}>{t("captions.jumpToLive")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const Line = memo(function Line({
  line,
  mode,
  showOriginal,
  fontScale,
  translationRtl,
  unavailable,
}: {
  line: CaptionLine;
  mode: Props["mode"];
  showOriginal: boolean;
  fontScale: number;
  translationRtl: boolean;
  unavailable: string;
}) {
  const dir = translationRtl ? styles.rtl : styles.ltr;
  const inProgress = !line.sourceFinal || !line.translationFinal;
  const translation = line.error ? (
    <Text style={[styles.translation, dir, styles.errorText, { fontSize: 15 * fontScale }]}>{unavailable}</Text>
  ) : line.translation ? (
    <Text
      style={[
        styles.translation,
        dir,
        { fontSize: (mode === "listener" ? 22 : 16) * fontScale, lineHeight: (mode === "listener" ? 31 : 23) * fontScale },
        mode === "speaker" && { color: colors.textMuted },
        !line.translationFinal && styles.interim,
      ]}
    >
      {line.translation}
    </Text>
  ) : (
    <Text style={[styles.translation, dir, styles.pending, { fontSize: 18 * fontScale }]}>…</Text>
  );

  const original = (
    <Text
      style={[
        styles.original,
        mode === "speaker"
          ? { fontSize: 21 * fontScale, lineHeight: 32 * fontScale, color: colors.text }
          : { fontSize: 15 * fontScale, lineHeight: 24 * fontScale },
        !line.sourceFinal && styles.interim,
      ]}
    >
      {line.original}
    </Text>
  );

  return (
    <View style={[styles.line, inProgress && styles.lineActive]}>
      {mode === "listener" ? (
        <>
          {translation}
          {showOriginal && !!line.original && original}
        </>
      ) : (
        <>
          {original}
          {showOriginal && translation}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.md, gap: spacing.sm },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  line: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  lineActive: { backgroundColor: colors.surface, borderLeftColor: colors.primary },
  translation: { color: colors.text, fontWeight: "500" },
  // Captions keep their own language direction regardless of the UI language.
  ltr: { writingDirection: "ltr", textAlign: "left" },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  original: { color: colors.textMuted, writingDirection: "rtl", textAlign: "right" },
  interim: { opacity: 0.7 },
  pending: { color: colors.textDim },
  errorText: { color: colors.warning, fontStyle: "italic" },
  jump: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  jumpText: { color: "#fff", fontWeight: "600" },
});
