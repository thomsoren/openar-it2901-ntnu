"""
Shared frame source for MJPEG streaming and detection.
"""
from __future__ import annotations

import asyncio
import queue
import threading
import time
from dataclasses import dataclass
from typing import List, Tuple

import cv2


@dataclass
class FramePacket:
    frame_index: int
    timestamp: float
    frame: object


class FrameSource:
    def __init__(self, source: str) -> None:
        self.source = source
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._async_subscribers: List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []
        self._thread_subscribers: List[queue.Queue] = []
        self._start_wall = time.monotonic()
        self._frame_index = 0

    def start(self) -> None:
        # Single capture thread feeds both MJPEG and detection subscribers.
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def subscribe_async(self, loop: asyncio.AbstractEventLoop, maxsize: int = 5) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        with self._lock:
            self._async_subscribers.append((loop, q))
        return q

    def unsubscribe_async(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._async_subscribers = [(loop, sub) for (loop, sub) in self._async_subscribers if sub is not q]

    def subscribe_thread(self, maxsize: int = 5) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=maxsize)
        with self._lock:
            self._thread_subscribers.append(q)
        return q

    def unsubscribe_thread(self, q: queue.Queue) -> None:
        with self._lock:
            self._thread_subscribers = [sub for sub in self._thread_subscribers if sub is not q]

    def _broadcast(self, packet: FramePacket) -> None:
        with self._lock:
            async_subscribers = list(self._async_subscribers)
            thread_subscribers = list(self._thread_subscribers)

        for loop, q in async_subscribers:
            def enqueue_async(queue_ref: asyncio.Queue = q, payload: FramePacket = packet) -> None:
                if queue_ref.full():
                    try:
                        queue_ref.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                try:
                    queue_ref.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

            loop.call_soon_threadsafe(enqueue_async)

        for q in thread_subscribers:
            if q.full():
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
            try:
                q.put_nowait(packet)
            except queue.Full:
                pass

    def _timestamp_from_capture(self, cap: cv2.VideoCapture) -> float:
        # Prefer capture timestamps to keep video/detections aligned.
        pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
        if pos_msec and pos_msec > 0:
            return pos_msec / 1000.0

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps and fps > 1:
            return self._frame_index / fps

        return time.monotonic() - self._start_wall

    def _run(self) -> None:
        cap = cv2.VideoCapture(self.source)
        if not cap.isOpened():
            return

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = (1.0 / fps) if fps and fps > 1 else None
        next_frame_time = time.monotonic()

        while True:
            ret, frame = cap.read()
            if not ret:
                # Loop file sources for demo repeatability.
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._frame_index = 0
                self._start_wall = time.monotonic()
                continue

            self._frame_index += 1
            timestamp = self._timestamp_from_capture(cap)

            packet = FramePacket(
                frame_index=self._frame_index,
                timestamp=timestamp,
                frame=frame,
            )
            self._broadcast(packet)

            if frame_interval is not None:
                next_frame_time += frame_interval
                sleep_time = next_frame_time - time.monotonic()
                if sleep_time > 0:
                    time.sleep(sleep_time)
