import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';
import { PLAYER_CHANNEL, createNativePlayerHTML, isAllowedPlayerNavigation, isTrustedFrameMessage, parsePlayerMessage, parseYouTubeVideoId } from './youtube-player.mjs';

export type MediaPlayerState = { playing: boolean; buffering: boolean; position: number; duration: number; playbackRate?: number; error?: string };
export type MediaPlayerProps = { url: string; title: string; onState: (state: MediaPlayerState) => void; paused?: boolean };
const idle: MediaPlayerState = { playing: false, buffering: false, position: 0, duration: 0, playbackRate: 1 };

function createNonce() {
  // The nonce isolates messages; source-window/origin checks are the authority boundary.
  const prefix = String(Constants.sessionId || 'kbc').replace(/[^A-Za-z0-9_-]/g, '');
  return (prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 150);
}
function nativeOrigin() {
  const id = Platform.OS === 'ios' ? Constants.expoConfig?.ios?.bundleIdentifier : Constants.expoConfig?.android?.package;
  if (!id || !/^[A-Za-z0-9]+(?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(id)) return null;
  return 'https://' + id.toLowerCase();
}

/** Visible official player only: no autoplay, downloaded streams, audio extraction or background video. */
export default function MediaPlayer(props: MediaPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  return <PlayerInstance key={props.url + ':' + attempt} {...props} onRetry={() => setAttempt(value => value + 1)} />;
}
function PlayerInstance({ url, title, onState, paused = false, onRetry }: MediaPlayerProps & {onRetry: () => void}) {
  const dimensions = useWindowDimensions(), viewportHeight = useRef(dimensions.height);
  viewportHeight.current = dimensions.height;
  const videoId = useMemo(() => parseYouTubeVideoId(url), [url]);
  const nonce = useMemo(createNonce, []);
  const origin = Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.location.origin : '') : nativeOrigin();
  const iframe = useRef<HTMLIFrameElement | null>(null), webview = useRef<WebView | null>(null);
  const callback = useRef(onState), lastState = useRef<MediaPlayerState>(idle), active = useRef(true), hostPaused = useRef(paused);
  const failed = useRef(false);
  const lastMessage = useRef(Date.now()), appVisible = useRef(AppState.currentState === 'active'), inViewport = useRef(true);
  const [error, setError] = useState(''), [height, setHeight] = useState(230);
  const container = useRef<View | null>(null);
  callback.current = onState; hostPaused.current = paused;
  const blocked = () => failed.current || hostPaused.current || !appVisible.current || !inViewport.current;
  const publish = useCallback((state: MediaPlayerState) => {
    if (!active.current) return;
    const safe = blocked() ? { ...state, playing: false, buffering: false } : state;
    lastState.current = safe;
    if (safe.error) setError(safe.error);
    callback.current(safe);
  }, []);
  const commandPause = useCallback(() => {
    const value = blocked();
    if (Platform.OS === 'web') {
      if (origin && iframe.current?.contentWindow) iframe.current.contentWindow.postMessage({ channel: PLAYER_CHANNEL, type: 'pause', nonce, paused: value }, origin);
    } else {
      try { webview.current?.injectJavaScript(`window.kbcPlayerPause && window.kbcPlayerPause(${JSON.stringify(nonce)},${value ? 'true' : 'false'});true;`); } catch { /* Already unmounted. */ }
    }
    if (value) publish({ ...lastState.current, playing: false, buffering: false });
  }, [origin, nonce, publish]);
  const reportFailure = useCallback((message: string) => {
    failed.current = true;
    commandPause();
    publish({ ...lastState.current, playing: false, buffering: false, error: message });
  }, [commandPause, publish]);
  const nativeHTML = useMemo(() => videoId && origin ? createNativePlayerHTML({ videoId, nonce, origin, paused }) : '', [videoId, nonce, origin]);
  const webSource = useMemo(() => {
    if (!videoId || !origin) return '';
    const target = new URL('/player.html', origin);
    target.hash = new URLSearchParams({ video: videoId, nonce, paused: paused ? '1' : '0' }).toString();
    return target.toString();
  }, [videoId, nonce, origin]);

  useEffect(() => { commandPause(); }, [paused, commandPause]);
  useEffect(() => {
    active.current = true;
    callback.current(idle);
    if (!videoId || !origin) {
      reportFailure(!videoId ? 'This is not a supported public YouTube video link.' : 'This app’s video identity is not configured. Open the official video.');
      return () => { active.current = false; };
    }
    const receive = (event: MessageEvent) => {
      const state = isTrustedFrameMessage(event, iframe.current?.contentWindow, origin, nonce);
      if (!state) return;
      lastMessage.current = Date.now(); publish(state);
    };
    const visibility = () => {
      appVisible.current = document.visibilityState === 'visible'; commandPause();
    };
    let observer: IntersectionObserver | undefined;
    let nativeVisibility: ReturnType<typeof AppState.addEventListener> | undefined;
    if (Platform.OS === 'web') {
      appVisible.current = document.visibilityState === 'visible';
      window.addEventListener('message', receive);
      document.addEventListener('visibilitychange', visibility);
      if (typeof IntersectionObserver !== 'undefined' && iframe.current) {
        observer = new IntersectionObserver(entries => { inViewport.current = Boolean(entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.5); commandPause(); }, { threshold: [0, 0.5] });
        observer.observe(iframe.current);
      }
    } else {
      nativeVisibility = AppState.addEventListener('change', state => { appVisible.current = state === 'active'; commandPause(); });
    }
    const watchdog = setInterval(() => {
      if (Platform.OS !== 'web' && appVisible.current) container.current?.measureInWindow((_x, y, _width, measuredHeight) => {
        if (!active.current || measuredHeight <= 0) return;
        const ratio = Math.max(0, Math.min(y + measuredHeight, viewportHeight.current) - Math.max(y, 0)) / measuredHeight;
        const visibleNow = ratio >= 0.5;
        if (visibleNow !== inViewport.current) { inViewport.current = visibleNow; commandPause(); }
      });
      if (lastState.current.playing && Date.now() - lastMessage.current > 6000) reportFailure('Playback updates stopped. Pause and reopen the video; unverified time is not counted.');
    }, 1000);
    const initialTimeout = setTimeout(() => {
      if (Date.now() - lastMessage.current > 20000) reportFailure('The video player could not load. Check your connection or open the official video.');
    }, 25000);
    return () => {
      hostPaused.current = true; commandPause();
      active.current = false; clearInterval(watchdog); clearTimeout(initialTimeout);
      observer?.disconnect(); nativeVisibility?.remove();
      if (Platform.OS === 'web') { window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visibility); }
      callback.current({ ...lastState.current, playing: false, buffering: false });
    };
  }, [videoId, origin, nonce, commandPause, publish, reportFailure]);

  return <View ref={container} onLayout={event => setHeight(Math.max(230, Math.round(event.nativeEvent.layout.width * 9 / 16)))} style={styles.container}>
    {videoId && origin && (Platform.OS === 'web' ? React.createElement('iframe', {
      ref: (node: HTMLIFrameElement | null) => { iframe.current = node; }, src: webSource, title,
      style: { width: '100%', height, minHeight: 230, border: 0, display: 'block', background: '#10271f' },
      allow: 'accelerometer; encrypted-media; gyroscope; fullscreen', allowFullScreen: true,
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups', referrerPolicy: 'strict-origin-when-cross-origin', onLoad: commandPause,
    }) : <WebView ref={webview} source={{ html: nativeHTML, baseUrl: origin + '/' }} style={{ height, flex: 0, backgroundColor: '#10271f' }}
      originWhitelist={['*']} javaScriptEnabled domStorageEnabled mediaPlaybackRequiresUserAction allowsInlineMediaPlayback allowsFullscreenVideo
      allowsPictureInPictureMediaPlayback={false} allowsAirPlayForMediaPlayback={false} javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never"
      onLoadEnd={commandPause}
      onShouldStartLoadWithRequest={request => isAllowedPlayerNavigation(request.url, origin, request.isTopFrame === true)}
      onOpenWindow={() => reportFailure('Use Open on YouTube to continue in the official player.')}
      onMessage={event => {
        const documentURL = event.nativeEvent.url;
        if (documentURL !== 'about:blank' && documentURL !== origin + '/' && documentURL !== origin) return;
        const state = parsePlayerMessage(event.nativeEvent.data, nonce);
        if (state) { lastMessage.current = Date.now(); publish(state); }
      }}
      onError={() => reportFailure('The video player could not load. Open the official video or try again later.')}
      onContentProcessDidTerminate={() => reportFailure('The video player stopped. Reopen this activity to continue.')}
    />)}
    {!!error && <><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.action}><Text style={styles.actionText}>Try video again</Text></Pressable>
      {!!videoId && <Pressable accessibilityRole="link" onPress={async () => {
        reportFailure('Opening YouTube. Time watched outside this app is not recorded here.');
        try { await Linking.openURL('https://www.youtube.com/watch?v=' + videoId); }
        catch { setError('YouTube could not open. Check your connection and try again.'); }
      }} style={styles.action}><Text style={styles.actionText}>Open on YouTube</Text></Pressable>}
    </>}
  </View>;
}
const styles = StyleSheet.create({ container: { width: '100%', minHeight: 230, overflow: 'hidden', borderRadius: 16, backgroundColor: '#10271f' }, error: { color: '#fff', padding: 14, fontSize: 15, lineHeight: 22 }, action: {minHeight: 48, padding: 14, justifyContent: 'center'}, actionText: {color: '#fff', fontSize: 16, textDecorationLine: 'underline'} });

export { MediaPlayer };
