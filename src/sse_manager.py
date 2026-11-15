"""Server-Sent Events Manager für Dice Deals.

Hält pro Spielraum eine Liste von Nachrichtenschlangen offen. Jeder verbundene
Client bekommt eine eigene Queue; der Server pusht den Game-State an alle
Queues des Raums, wenn sich etwas ändert.
"""

import json
import queue
import threading
from typing import Dict, List, Optional

# room_code -> Liste von queue.Queue mit Game-State-Dicts
_room_queues: Dict[str, List[queue.Queue]] = {}
_lock = threading.Lock()


def subscribe(room_code: str) -> queue.Queue:
    """Legt eine neue Queue für einen Client an und gibt sie zurück."""
    q = queue.Queue()
    with _lock:
        _room_queues.setdefault(room_code, []).append(q)
    return q


def unsubscribe(room_code: str, q: queue.Queue) -> None:
    """Entfernt die Queue eines Clients; räumt den Raum auf, wenn keiner mehr da ist."""
    with _lock:
        queues = _room_queues.get(room_code)
        if queues:
            try:
                queues.remove(q)
            except ValueError:
                pass
            if not queues:
                _room_queues.pop(room_code, None)


def push(room_code: str, state: dict) -> None:
    """Schickt einen Game-State an alle Abonnenten des Raums."""
    queues = _room_queues.get(room_code)
    if not queues:
        return
    payload = json.dumps(state, ensure_ascii=False)
    for q in list(queues):
        try:
            q.put_nowait(payload)
        except queue.Full:
            pass
