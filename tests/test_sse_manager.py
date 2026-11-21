import json
import queue

import sse_manager


def setup_function():
    sse_manager._room_queues.clear()


def test_subscriber_receives_pushed_state():
    subscriber = sse_manager.subscribe("ABC123")
    state = {"players": [{"username": "Alice"}], "message": "Hallo"}

    sse_manager.push("ABC123", state)

    assert json.loads(subscriber.get_nowait()) == state


def test_each_subscriber_receives_own_message():
    first = sse_manager.subscribe("ABC123")
    second = sse_manager.subscribe("ABC123")

    sse_manager.push("ABC123", {"revision": 4})

    assert json.loads(first.get_nowait()) == {"revision": 4}
    assert json.loads(second.get_nowait()) == {"revision": 4}


def test_push_does_not_send_to_other_rooms():
    subscriber = sse_manager.subscribe("ROOM-A")

    sse_manager.push("ROOM-B", {"revision": 1})

    assert subscriber.empty()


def test_unsubscribe_stops_delivery():
    subscriber = sse_manager.subscribe("ABC123")
    sse_manager.unsubscribe("ABC123", subscriber)

    sse_manager.push("ABC123", {"revision": 2})

    assert subscriber.empty()


def test_unsubscribing_unknown_queue_is_safe():
    subscriber = queue.Queue()
    sse_manager.unsubscribe("MISSING", subscriber)


def test_push_without_subscribers_is_safe():
    sse_manager.push("EMPTY", {"ok": True})
