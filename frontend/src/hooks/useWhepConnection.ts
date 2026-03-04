import { RefObject, useEffect, useRef, useState } from "react";

export type WhepConnectionStatus = "idle" | "connecting" | "playing" | "stalled" | "error";

interface UseWhepConnectionOptions {
  whepUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  sessionToken?: number;
}

interface UseWhepConnectionResult {
  status: WhepConnectionStatus;
  error: string | null;
}

const parseIceServers = (linkHeader: string | null): RTCIceServer[] => {
  if (!linkHeader) {
    return [];
  }

  return linkHeader
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => {
      const match = entry.match(/^<([^>]+)>(.*)$/);
      if (!match) {
        return null;
      }

      const url = match[1];
      const params = match[2] ?? "";
      if (!/rel="?ice-server"?/i.test(params)) {
        return null;
      }

      const username = params.match(/username="([^"]+)"/i)?.[1];
      const credential = params.match(/credential="([^"]+)"/i)?.[1];
      const server: RTCIceServer = { urls: [url] };
      if (username) {
        server.username = username;
      }
      if (credential) {
        server.credential = credential;
      }
      return server;
    })
    .filter((value): value is RTCIceServer => Boolean(value));
};

const ICE_GATHERING_TIMEOUT_MS = 3000;
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

const waitForIceGathering = (pc: RTCPeerConnection): Promise<void> => {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ICE_GATHERING_TIMEOUT_MS);

    const onChange = () => {
      if (pc.iceGatheringState !== "complete") {
        return;
      }
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onChange);
    };

    pc.addEventListener("icegatheringstatechange", onChange);
  });
};

const parseEnvNumber = (name: string, fallback: number): number => {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const MAX_WHEP_RETRIES = parseEnvNumber("VITE_WHEP_MAX_RETRIES", 12);
const WHEP_RETRY_DELAY_MS = parseEnvNumber("VITE_WHEP_RETRY_DELAY_MS", 750);
const WHEP_RETRY_MAX_DELAY_MS = parseEnvNumber("VITE_WHEP_RETRY_MAX_DELAY_MS", 4000);
const ICE_CONNECTION_TIMEOUT_MS = parseEnvNumber("VITE_WHEP_ICE_TIMEOUT_MS", 8000);
const WHEP_RETRYABLE_HTTP_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

const isRetryableWhepStatus = (status: number): boolean => WHEP_RETRYABLE_HTTP_STATUSES.has(status);

/**
 * Hook for establishing and managing a WHEP/WebRTC receive-only session.
 * Negotiates SDP against MediaMTX WHEP endpoint and maps connection/media events to UI state.
 * Retries the WHEP offer automatically when the stream is not yet available (404/503).
 *
 * @param whepUrl - WHEP endpoint URL; when null the hook stays idle
 * @param videoRef - Target video element ref for attaching remote stream
 * @param enabled - Whether connection should be active
 * @param sessionToken - Token used to force reconnect when incremented
 */
export function useWhepConnection({
  whepUrl,
  videoRef,
  enabled,
  sessionToken = 0,
}: UseWhepConnectionOptions): UseWhepConnectionResult {
  const [status, setStatus] = useState<WhepConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const iceTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !whepUrl) {
      setStatus("idle");
      setError(null);
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) {
      setStatus("error");
      setError("Video element missing");
      return;
    }

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let mediaPlayable = videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const fetchController = new AbortController();
    retryCountRef.current = 0;

    const clearIceTimeout = () => {
      if (iceTimeoutRef.current !== null) {
        window.clearTimeout(iceTimeoutRef.current);
        iceTimeoutRef.current = null;
      }
    };

    const markError = (message: string) => {
      if (cancelled) {
        return;
      }
      setError(message);
      setStatus("error");
    };

    const scheduleRetry = (reason: string): boolean => {
      if (cancelled) {
        return true;
      }
      if (retryCountRef.current >= MAX_WHEP_RETRIES) {
        return false;
      }
      retryCountRef.current += 1;
      const delay = Math.min(
        WHEP_RETRY_DELAY_MS * Math.pow(1.5, retryCountRef.current - 1),
        WHEP_RETRY_MAX_DELAY_MS
      );
      setError(`${reason}; retrying (${retryCountRef.current}/${MAX_WHEP_RETRIES})`);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void connect();
      }, delay);
      return true;
    };

    const handleLoadedData = () => {
      if (!cancelled) {
        mediaPlayable = true;
        setStatus("playing");
      }
    };

    const handlePlaying = () => {
      if (!cancelled) {
        mediaPlayable = true;
        setStatus("playing");
      }
    };

    const handleWaiting = () => {
      if (!cancelled) {
        setStatus("stalled");
      }
    };

    const handleStalled = () => {
      if (!cancelled) {
        setStatus("stalled");
      }
    };

    const handleError = () => {
      markError("WebRTC video element error");
    };

    videoEl.addEventListener("loadeddata", handleLoadedData);
    videoEl.addEventListener("playing", handlePlaying);
    videoEl.addEventListener("waiting", handleWaiting);
    videoEl.addEventListener("stalled", handleStalled);
    videoEl.addEventListener("error", handleError);

    const connect = async () => {
      if (cancelled) return;

      if (pc) {
        pc.close();
        pc = null;
      }

      mediaPlayable = videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

      try {
        setStatus("connecting");
        setError(null);

        const optionsResponse = await fetch(whepUrl, {
          method: "OPTIONS",
          signal: fetchController.signal,
        });
        if (cancelled) return;

        if (!optionsResponse.ok) {
          if (
            isRetryableWhepStatus(optionsResponse.status) &&
            scheduleRetry("WHEP OPTIONS pending")
          ) {
            return;
          }
          markError(`WHEP OPTIONS rejected (${optionsResponse.status})`);
          return;
        }

        const parsedIceServers = parseIceServers(optionsResponse.headers.get("Link"));
        const iceServers = parsedIceServers.length > 0 ? parsedIceServers : DEFAULT_ICE_SERVERS;
        pc = new RTCPeerConnection({ iceServers });

        pc.onconnectionstatechange = () => {
          if (cancelled) {
            return;
          }
          if (pc?.connectionState === "connected") {
            clearIceTimeout();
          } else if (pc?.connectionState === "disconnected") {
            setStatus("stalled");
          } else if (pc?.connectionState === "failed") {
            clearIceTimeout();
            markError("WebRTC connection failed");
          }
        };

        pc.ontrack = (event) => {
          if (cancelled) {
            return;
          }
          mediaPlayable = videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
          clearIceTimeout();

          try {
            const receiver = event.receiver as RTCRtpReceiver & {
              playoutDelayHint?: number;
              jitterBufferTarget?: number;
            };
            if (typeof receiver.playoutDelayHint === "number") {
              receiver.playoutDelayHint = 0;
            }
            if (typeof receiver.jitterBufferTarget === "number") {
              receiver.jitterBufferTarget = 0;
            }
          } catch {
            // Ignore unsupported receiver tuning knobs.
          }

          const [stream] = event.streams;
          if (!stream) {
            return;
          }
          videoEl.srcObject = stream;
          void videoEl.play().catch(() => {
            // Autoplay can reject transiently while metadata is pending.
          });
        };

        pc.addTransceiver("video", { direction: "recvonly" });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        if (cancelled) return;

        const localSdp = pc.localDescription?.sdp;
        if (!localSdp) {
          throw new Error("WebRTC offer generation failed");
        }

        const offerResponse = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: localSdp,
          signal: fetchController.signal,
        });
        if (cancelled) return;

        if (!offerResponse.ok) {
          pc.close();
          pc = null;

          if (
            isRetryableWhepStatus(offerResponse.status) &&
            scheduleRetry(`WHEP offer pending (${offerResponse.status})`)
          ) {
            return;
          }

          markError(`WHEP offer rejected (${offerResponse.status})`);
          return;
        }

        const location = offerResponse.headers.get("Location");
        if (location) {
          sessionUrl = new URL(location, whepUrl).toString();
        }

        const answerSdp = await offerResponse.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        if (cancelled) return;

        iceTimeoutRef.current = window.setTimeout(() => {
          iceTimeoutRef.current = null;
          const effectivelyPlayable =
            mediaPlayable || videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
          if (!cancelled && pc?.connectionState !== "connected" && !effectivelyPlayable) {
            markError("WebRTC ICE connection timeout");
          }
        }, ICE_CONNECTION_TIMEOUT_MS);
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (cancelled || isAbort) {
          return;
        }
        if (scheduleRetry("WHEP connection failed")) {
          return;
        }
        markError(err instanceof Error ? err.message : "WebRTC session setup failed");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      fetchController.abort();

      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      clearIceTimeout();

      videoEl.removeEventListener("loadeddata", handleLoadedData);
      videoEl.removeEventListener("playing", handlePlaying);
      videoEl.removeEventListener("waiting", handleWaiting);
      videoEl.removeEventListener("stalled", handleStalled);
      videoEl.removeEventListener("error", handleError);

      if (sessionUrl) {
        void fetch(sessionUrl, { method: "DELETE" }).catch(() => {
          // Ignore teardown errors.
        });
      }

      if (pc) {
        pc.close();
      }
      videoEl.srcObject = null;
    };
  }, [enabled, sessionToken, videoRef, whepUrl]);

  return { status, error };
}
