import json
from pathlib import Path
from typing import Optional

import numpy as np


BOOKMARK_PATH = Path(__file__).resolve().parent.parent / "camera_bookmark.json"


def load_camera_bookmark(path: Path = BOOKMARK_PATH) -> Optional[dict]:
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    required_keys = {"position", "yaw", "pitch", "roll", "fov"}
    if not required_keys.issubset(data):
        return None

    try:
        position = np.array(data["position"], dtype=np.float32)
        yaw = float(data["yaw"])
        pitch = float(data["pitch"])
        roll = float(data["roll"])
        fov = float(data["fov"])
    except (TypeError, ValueError):
        return None

    return {
        "position": position,
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "fov": fov,
    }


def save_camera_bookmark(camera, path: Path = BOOKMARK_PATH) -> bool:
    payload = {
        "position": [float(v) for v in camera.position.tolist()],
        "yaw": float(camera.yaw),
        "pitch": float(camera.pitch),
        "roll": float(camera.roll),
        "fov": float(camera.fov_degrees),
    }

    try:
        path.write_text(json.dumps(payload, indent=2))
    except OSError:
        return False

    return True
