"""Tests for _offer_latest — the non-blocking drop-oldest queue helper."""
from __future__ import annotations

import threading
from multiprocessing import Queue

from cv.worker import _offer_latest


def test_offer_puts_to_empty_queue():
    q = Queue(maxsize=2)
    _offer_latest(q, "a")
    assert q.get_nowait() == "a"


def test_offer_drops_oldest_when_full():
    q = Queue(maxsize=1)
    _offer_latest(q, "old")
    _offer_latest(q, "new")
    assert q.get_nowait() == "new"


def test_offer_repeated_drops_keep_latest():
    q = Queue(maxsize=1)
    for i in range(100):
        _offer_latest(q, i)
    assert q.get_nowait() == 99


def test_offer_none_sentinel():
    q = Queue(maxsize=1)
    _offer_latest(q, None)
    assert q.get_nowait() is None


def test_offer_thread_safe():
    """50 threads offering concurrently must not deadlock or raise."""
    q = Queue(maxsize=3)
    barrier = threading.Barrier(50)
    errors = []

    def _offer(value):
        try:
            barrier.wait(timeout=2)
            for _ in range(20):
                _offer_latest(q, value)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=_offer, args=(i,)) for i in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert not errors, f"Threads raised: {errors}"


def test_queue_never_exceeds_maxsize():
    q = Queue(maxsize=3)
    for i in range(200):
        _offer_latest(q, i)
    assert q.qsize() <= 3
