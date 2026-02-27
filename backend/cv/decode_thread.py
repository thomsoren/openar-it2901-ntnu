"""Decode thread — continuously reads frames from a video source into a thread-safe slot."""
from __future__ import annotations

import logging
import random
import threading
import time
from urllib.parse import urlparse

import cv2
import numpy as np

from cv.config import DEFAULT_FPS, INITIAL_RECONNECT_BACKOFF_SEC, MAX_RECONNECT_BACKOFF_SEC
from cv.runtime import STREAM_MAX_CATCHUP_SKIP, STREAM_MAX_RECONNECT_ATTEMPTS

logger = logging.getLogger(__name__)


def _is_remote_stream_url(source_url: str) -> bool:
    scheme = urlparse(source_url).scheme.lower()
    return scheme in {"rtsp", "http", "https", "rtmp", "udp", "tcp"}


def _jittered_backoff(current: float, maximum: float) -> float:
    return min(current * 2.0 * random.uniform(0.8, 1.2), maximum)


class DecodeThread:
    """Continuously decodes frames from a video source into a thread-safe latest-frame slot.

    Preserves all timing/recovery behaviours from the original worker.py reader:
    - FPS pacing for local files
    - Catchup-skip for wall-clock alignment
    - Reconnection with exponential backoff for remote sources
    - PTS preference with monotonic fallback
    """

    def __init__(self, source_url: str, stream_id: str, loop: bool = True):
        self.source_url = source_url
        self.stream_id = stream_id
        self.loop = loop

        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._frame_idx: int = 0
        self._timestamp_ms: float = 0.0

        self._fps: float = DEFAULT_FPS
        self._width: int = 0
        self._height: int = 0

        self._thread: threading.Thread | None = None
        self._stopped = threading.Event()
        self._is_remote = _is_remote_stream_url(source_url)

    def start(self) -> bool:
        """Open the video source and start the reader thread.

        Returns False if the source cannot be opened.
        """
        cap = cv2.VideoCapture(self.source_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            logger.error("[%s] Failed to open source: %s", self.stream_id, self.source_url)
            cap.release()
            return False

        fps_raw = cap.get(cv2.CAP_PROP_FPS)
        if not fps_raw or fps_raw <= 1 or fps_raw > 240:
            self._fps = DEFAULT_FPS
        else:
            self._fps = float(fps_raw)
        self._width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self._height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        self._stopped.clear()
        self._thread = threading.Thread(
            target=self._reader_loop, args=(cap,), daemon=True,
        )
        self._thread.start()
        return True

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    def get_latest(self) -> tuple[np.ndarray | None, int, float]:
        """Return (frame, frame_idx, timestamp_ms). Thread-safe."""
        with self._lock:
            return self._frame, self._frame_idx, self._timestamp_ms

    def stop(self) -> None:
        self._stopped.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    @property
    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ------------------------------------------------------------------
    # Internal reader loop — same logic as worker.py reader()
    # ------------------------------------------------------------------

    def _reader_loop(self, cap: cv2.VideoCapture) -> None:
        source_fps = self._fps
        allow_catchup_skips = not self._is_remote
        max_catchup_skip = STREAM_MAX_CATCHUP_SKIP
        max_reconnect_attempts = STREAM_MAX_RECONNECT_ATTEMPTS

        frame_idx = -1
        start_mono = time.monotonic()
        read_interval = 1.0 / source_fps if source_fps > 0 else 0.04
        next_read_time = time.monotonic()
        last_ts_ms = 0.0
        reconnect_backoff = INITIAL_RECONNECT_BACKOFF_SEC
        reconnect_attempts = 0

        try:
            while not self._stopped.is_set():
                if not cap.isOpened():
                    if self._is_remote:
                        reconnect_attempts += 1
                        if reconnect_attempts > max_reconnect_attempts:
                            logger.error(
                                "[%s] Giving up after %d reconnect attempts",
                                self.stream_id, max_reconnect_attempts,
                            )
                            break
                        logger.warning(
                            "[%s] Source disconnected; reconnecting in %.1fs (attempt %d/%d)",
                            self.stream_id, reconnect_backoff,
                            reconnect_attempts, max_reconnect_attempts,
                        )
                        time.sleep(reconnect_backoff)
                        reconnect_backoff = _jittered_backoff(reconnect_backoff, MAX_RECONNECT_BACKOFF_SEC)
                        cap = cv2.VideoCapture(self.source_url)
                        continue
                    break

                # Catchup-skip: keep source timeline aligned to wall-clock
                if allow_catchup_skips and source_fps > 0:
                    expected_source_idx = int((time.monotonic() - start_mono) * source_fps)
                    lag_frames = expected_source_idx - (frame_idx + 1)
                    if lag_frames > 0:
                        to_skip = min(lag_frames, max_catchup_skip)
                        for _ in range(to_skip):
                            if not cap.grab():
                                break
                            frame_idx += 1

                ret, frame = cap.read()
                if not ret:
                    if self._is_remote:
                        cap.release()
                        reconnect_attempts += 1
                        if reconnect_attempts > max_reconnect_attempts:
                            logger.error(
                                "[%s] Giving up after %d reconnect attempts",
                                self.stream_id, max_reconnect_attempts,
                            )
                            break
                        logger.warning(
                            "[%s] Source read failed; reconnecting in %.1fs (attempt %d/%d)",
                            self.stream_id, reconnect_backoff,
                            reconnect_attempts, max_reconnect_attempts,
                        )
                        time.sleep(reconnect_backoff)
                        reconnect_backoff = _jittered_backoff(reconnect_backoff, MAX_RECONNECT_BACKOFF_SEC)
                        cap = cv2.VideoCapture(self.source_url)
                        if cap.isOpened():
                            reconnect_backoff = INITIAL_RECONNECT_BACKOFF_SEC
                            reconnect_attempts = 0
                            start_mono = time.monotonic()
                            next_read_time = time.monotonic()
                            continue
                        continue
                    if self.loop:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        frame_idx = -1
                        start_mono = time.monotonic()
                        next_read_time = time.monotonic()
                        last_ts_ms = 0.0
                        continue
                    break

                frame_idx += 1

                # Prefer source media PTS when available; fallback to monotonic wall-time.
                ts_source = cap.get(cv2.CAP_PROP_POS_MSEC)
                if ts_source and ts_source > 0:
                    ts = float(ts_source)
                else:
                    ts = (time.monotonic() - start_mono) * 1000.0
                # Keep monotonic non-decreasing timestamps
                if ts < last_ts_ms:
                    ts = last_ts_ms
                else:
                    last_ts_ms = ts

                with self._lock:
                    self._frame = frame
                    self._frame_idx = frame_idx
                    self._timestamp_ms = ts

                # FPS pacing for local file playback
                if not self._is_remote:
                    next_read_time += read_interval
                    sleep = next_read_time - time.monotonic()
                    if sleep > 0:
                        time.sleep(sleep)
                    elif sleep < -(read_interval * 3):
                        next_read_time = time.monotonic()
        finally:
            cap.release()
