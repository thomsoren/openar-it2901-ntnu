export interface StreamAlert {
  id: string;
  source: "video" | "data" | "system";
  title: string;
  detail: string;
  recovery?: string;
}

const trimMessage = (message: string | null | undefined): string | null => {
  const value = message?.trim();
  return value ? value : null;
};

const withRecovery = (message: string | null | undefined): string | undefined => {
  const value = trimMessage(message);
  return value ?? undefined;
};

export const describeVideoStreamError = (
  message: string | null | undefined
): StreamAlert | null => {
  const value = trimMessage(message);
  if (!value) {
    return null;
  }

  const lower = value.toLowerCase();

  if (lower.includes("whep options rejected")) {
    const status = value.match(/\((\d{3})\)/)?.[1];
    if (status === "401" || status === "403") {
      return {
        id: "video-auth",
        source: "video",
        title: "Video stream access denied",
        detail: "The playback service rejected authorization for the video stream.",
      };
    }
    if (status === "404") {
      return {
        id: "video-offline",
        source: "video",
        title: "Video stream not available",
        detail: "The playback service could not find the requested video stream.",
      };
    }
    if (status === "503") {
      return {
        id: "video-starting",
        source: "video",
        title: "Video stream not ready",
        detail: "The playback service is up, but the video stream is not ready to serve yet.",
      };
    }
  }

  if (lower.includes("whep offer rejected")) {
    const status = value.match(/\((\d{3})\)/)?.[1];
    return {
      id: "video-negotiation",
      source: "video",
      title: "Video stream negotiation failed",
      detail: status
        ? `The playback service rejected WebRTC session setup with status ${status}.`
        : "The playback service rejected WebRTC session setup.",
    };
  }

  if (lower.includes("ice connection timeout")) {
    return {
      id: "video-ice-timeout",
      source: "video",
      title: "Video stream timed out",
      detail: "The browser did not establish a WebRTC media path before the timeout expired.",
    };
  }

  if (lower.includes("connection failed")) {
    return {
      id: "video-connection-failed",
      source: "video",
      title: "Video stream connection failed",
      detail: "The browser lost or could not maintain the live video connection.",
    };
  }

  if (lower.includes("hls fatal error")) {
    return {
      id: "video-hls-failed",
      source: "video",
      title: "Video fallback failed",
      detail: "The HLS fallback stream encountered a fatal playback error.",
    };
  }

  if (lower.includes("hls unsupported")) {
    return {
      id: "video-hls-unsupported",
      source: "video",
      title: "Video playback unsupported",
      detail: "This browser cannot play the fallback HLS stream.",
    };
  }

  if (lower.includes("video element missing") || lower.includes("hls url missing")) {
    return {
      id: "video-config",
      source: "video",
      title: "Video playback misconfigured",
      detail: "The app is missing required video playback configuration for this stream.",
    };
  }

  return {
    id: "video-generic",
    source: "video",
    title: "Video stream error",
    detail: value,
  };
};

export const describeDataStreamProblem = ({
  error,
  isConnected,
  isStale,
}: {
  error?: string | null;
  isConnected?: boolean;
  isStale?: boolean;
}): StreamAlert | null => {
  const value = trimMessage(error);
  const lower = value?.toLowerCase() ?? "";

  if (value) {
    if (lower.includes("websocket connection error")) {
      return {
        id: "data-disconnected",
        source: "data",
        title: "Detection data stream disconnected",
        detail: "The browser could not maintain the live detections feed for this stream.",
      };
    }

    return {
      id: "data-generic",
      source: "data",
      title: "Detection data stream error",
      detail: value,
    };
  }

  if (isStale && isConnected !== false) {
    return {
      id: "data-stalled",
      source: "data",
      title: "Detection data stream stalled",
      detail: "No detection updates have arrived recently, so overlay data may be outdated.",
    };
  }

  if (isConnected === false) {
    return {
      id: "data-offline",
      source: "data",
      title: "Detection data stream offline",
      detail: "The live detections feed is currently unavailable.",
    };
  }

  return null;
};

export const describeSystemProblem = (message: string | null | undefined): StreamAlert | null => {
  const value = trimMessage(message);
  if (!value) {
    return null;
  }

  const lower = value.toLowerCase();

  if (lower.includes("401") || lower.includes("unauthorized")) {
    return {
      id: "system-unauthorized",
      source: "system",
      title: "Authentication required",
      detail: "The backend rejected the request because the current session is not authorized.",
    };
  }

  if (lower.includes("403") || lower.includes("forbidden")) {
    return {
      id: "system-forbidden",
      source: "system",
      title: "Access denied",
      detail: "The current user does not have permission to access this stream resource.",
    };
  }

  return {
    id: "system-generic",
    source: "system",
    title: "Stream service error",
    detail: value,
  };
};

export const buildStreamAlerts = ({
  videoError,
  videoRecovery,
  dataError,
  dataRecovery,
  dataConnected,
  dataStale,
  systemError,
  systemRecovery,
}: {
  videoError?: string | null;
  videoRecovery?: string | null;
  dataError?: string | null;
  dataRecovery?: string | null;
  dataConnected?: boolean;
  dataStale?: boolean;
  systemError?: string | null;
  systemRecovery?: string | null;
}): StreamAlert[] => {
  const alerts: StreamAlert[] = [];

  const videoAlert = describeVideoStreamError(videoError);
  if (videoAlert) {
    alerts.push({
      ...videoAlert,
      recovery: withRecovery(videoRecovery),
    });
  }

  const dataAlert = describeDataStreamProblem({
    error: dataError,
    isConnected: dataConnected,
    isStale: dataStale,
  });
  if (dataAlert) {
    alerts.push({
      ...dataAlert,
      recovery: withRecovery(dataRecovery),
    });
  }

  const systemAlert = describeSystemProblem(systemError);
  if (systemAlert) {
    alerts.push({
      ...systemAlert,
      recovery: withRecovery(systemRecovery),
    });
  }

  return alerts;
};
