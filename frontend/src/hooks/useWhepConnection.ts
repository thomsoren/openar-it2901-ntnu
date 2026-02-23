import { RefObject, useEffect, useState } from "react";

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

export function useWhepConnection({
  whepUrl,
  videoRef,
  enabled,
  sessionToken = 0,
}: UseWhepConnectionOptions): UseWhepConnectionResult {
  const [status, setStatus] = useState<WhepConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

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
      try {
        setStatus("connecting");
        setError(null);

        const optionsResponse = await fetch(whepUrl, { method: "OPTIONS" });
        const iceServers = parseIceServers(optionsResponse.headers.get("Link"));
        pc = new RTCPeerConnection({ iceServers });

        pc.onconnectionstatechange = () => {
          if (cancelled) {
            return;
          }
          if (pc?.connectionState === "disconnected") {
            setStatus("stalled");
          } else if (pc?.connectionState === "failed") {
            markError("WebRTC connection failed");
          }
        };

        pc.ontrack = (event) => {
          if (cancelled) {
            return;
          }
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
          throw new Error(`WHEP offer rejected (${offerResponse.status})`);
        }

        const location = offerResponse.headers.get("Location");
        if (location) {
          sessionUrl = new URL(location, whepUrl).toString();
        }

        const answerSdp = await offerResponse.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch (err) {
        markError(err instanceof Error ? err.message : "WebRTC session setup failed");
      }
    };

    void connect();

    return () => {
      cancelled = true;

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
