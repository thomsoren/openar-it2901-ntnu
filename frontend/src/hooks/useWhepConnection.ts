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

const waitForIceGathering = (pc: RTCPeerConnection): Promise<void> => {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 500);

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

// Retry WHEP offer every 2s while the stream is starting up (FFmpeg/MediaMTX not ready yet).
// After MAX_WHEP_RETRIES the hook reports error so VideoPlayer can fall back to HLS.
const MAX_WHEP_RETRIES = 5;
const WHEP_RETRY_DELAY_MS = 2000;

// If WebRTC ICE hasn't connected within this window, give up and fall back to HLS.
// Chrome's own ICE failure timeout is ~30s; this forces a faster fallback.
const ICE_CONNECTION_TIMEOUT_MS = 8000;

/**
 * Hook for establishing and managing a WHEP/WebRTC receive-only session.
 * Negotiates SDP against MediaMTX WHEP endpoint and maps connection/media events to UI state.
 * Retries the WHEP offer automatically when the stream is not yet available (404/503).
 *
 * @param whepUrl - WHEP endpoint URL; when null the hook stays idle
 * @param videoRef - Target video element ref for attaching remote stream
 * @param enabled - Whether connection should be active
 * @param sessionToken - Token used to force reconnect when incremented
 *
 * @example
 * ```tsx
 * const { status, error } = useWhepConnection({
 *   whepUrl,
 *   videoRef,
 *   enabled: true,
 *   sessionToken,
 * });
 * ```
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
    retryCountRef.current = 0;

    const markError = (message: string) => {
      if (cancelled) {
        return;
      }
      setError(message);
      setStatus("error");
    };

    const handleLoadedData = () => {
      if (!cancelled) {
        setStatus("playing");
      }
    };
    const handlePlaying = () => {
      if (!cancelled) {
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

      // Close any RTCPeerConnection from a previous failed attempt before retrying.
      if (pc) {
        pc.close();
        pc = null;
      }

      try {
        setStatus("connecting");
        setError(null);

        const optionsResponse = await fetch(whepUrl, { method: "OPTIONS" });
        const iceServers = parseIceServers(optionsResponse.headers.get("Link"));
        pc = new RTCPeerConnection({ iceServers });

        const clearIceTimeout = () => {
          if (iceTimeoutRef.current !== null) {
            window.clearTimeout(iceTimeoutRef.current);
            iceTimeoutRef.current = null;
          }
        };

        // Set when ontrack fires — media flowing means ICE succeeded regardless
        // of whether connectionState has caught up to "connected" yet.
        let mediaReceived = false;

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
          mediaReceived = true;
          clearIceTimeout(); // no-op if timeout not set yet; flag handles that case
          // Chromium can default to a larger jitter/playout buffer than Safari.
          // Request minimum playout delay when supported to keep glass-to-glass latency low.
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

        const localSdp = pc.localDescription?.sdp;
        if (!localSdp) {
          throw new Error("WebRTC offer generation failed");
        }

        const offerResponse = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: localSdp,
        });

        if (!offerResponse.ok) {
          if (cancelled) return;

          // Stream not ready yet (MediaMTX returns 404/503 before FFmpeg publishes).
          // Close this PC and retry after a short delay rather than immediately erroring.
          pc.close();
          pc = null;

          if (retryCountRef.current < MAX_WHEP_RETRIES) {
            retryCountRef.current++;
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              void connect();
            }, WHEP_RETRY_DELAY_MS);
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
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        // Start ICE connection watchdog. If the peer connection hasn't reached
        // "connected" within the timeout, Chrome would otherwise wait ~30s on
        // its own before declaring failure. We fail fast and fall back to HLS.
        iceTimeoutRef.current = window.setTimeout(() => {
          iceTimeoutRef.current = null;
          if (!cancelled && !mediaReceived && pc?.connectionState !== "connected") {
            markError("WebRTC ICE connection timeout");
          }
        }, ICE_CONNECTION_TIMEOUT_MS);
      } catch (err) {
        if (!cancelled) {
          markError(err instanceof Error ? err.message : "WebRTC session setup failed");
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;

      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (iceTimeoutRef.current !== null) {
        window.clearTimeout(iceTimeoutRef.current);
        iceTimeoutRef.current = null;
      }

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
