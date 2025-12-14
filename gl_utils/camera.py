import numpy as np
from pyrr import quaternion

WORLD_UP = np.array([0.0, 1.0, 0.0], dtype=np.float32)


def normalize(v):
    norm = np.linalg.norm(v)
    if norm < 1e-8:
        return np.array(v, dtype=np.float32)
    return (v / norm).astype(np.float32)


def _safe_quaternion(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    axis = normalize(axis)
    if np.linalg.norm(axis) < 1e-6 or abs(angle_rad) < 1e-8:
        return quaternion.create()
    return quaternion.normalise(quaternion.create_from_axis_rotation(axis, angle_rad))


def _apply_quaternion(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    return quaternion.apply_to_vector(q, v).astype(np.float32)


class FPSCamera:
    def __init__(self, position, yaw, pitch, fov_degrees: float = 70.0):
        self.position = position.astype(np.float32)
        self.yaw = yaw
        self.pitch = pitch
        self.roll = 0.0
        self.fov_degrees = fov_degrees

        self.speed = 5.0
        self.sensitivity = 0.1
        self.roll_speed = 90.0
        self.min_radius = None

        self.reference_alignment_enabled = False
        self.reference_up = WORLD_UP.copy()
        self.velocity = np.zeros(3, dtype=np.float32)

        self.orientation = quaternion.create()
        self.front = np.array([0.0, 0.0, -1.0], dtype=np.float32)
        self.right = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        self.up = np.array([0.0, 1.0, 0.0], dtype=np.float32)

        self._rebuild_orientation()
        self._update_basis()

    def update_vectors(self):
        if self.reference_alignment_enabled:
            self._update_basis()
        else:
            self._rebuild_orientation()
            self._update_basis()

    def _rebuild_orientation(self):
        self.orientation = quaternion.create()

        base_up = self.reference_up if self.reference_alignment_enabled else WORLD_UP

        yaw_q = _safe_quaternion(base_up, np.radians(self.yaw))
        self.orientation = quaternion.cross(yaw_q, self.orientation)

        right_axis = _apply_quaternion(self.orientation, np.array([1.0, 0.0, 0.0], dtype=np.float32))
        pitch_q = _safe_quaternion(right_axis, np.radians(self.pitch))
        self.orientation = quaternion.cross(pitch_q, self.orientation)

        roll_amount = 0.0 if self.reference_alignment_enabled else self.roll
        forward_axis = _apply_quaternion(
            self.orientation, np.array([0.0, 0.0, -1.0], dtype=np.float32)
        )
        roll_q = _safe_quaternion(forward_axis, np.radians(roll_amount))
        self.orientation = quaternion.cross(roll_q, self.orientation)

        self.orientation = quaternion.normalise(self.orientation)

    def _update_basis(self):
        self.front = normalize(
            _apply_quaternion(self.orientation, np.array([0.0, 0.0, -1.0], dtype=np.float32))
        )
        self.right = normalize(
            _apply_quaternion(self.orientation, np.array([1.0, 0.0, 0.0], dtype=np.float32))
        )
        self.up = normalize(np.cross(self.right, self.front))

        if self.reference_alignment_enabled:
            self._realign_to_reference()

    def process_mouse(self, xoff, yoff):
        if xoff == 0 and yoff == 0:
            return

        yaw_delta = xoff * self.sensitivity
        pitch_delta = yoff * self.sensitivity

        self.yaw += yaw_delta
        prev_pitch = self.pitch
        self.pitch = max(-89.0, min(89.0, self.pitch + pitch_delta))
        pitch_delta = self.pitch - prev_pitch

        yaw_axis = self.reference_up if self.reference_alignment_enabled else self.up
        yaw_q = _safe_quaternion(yaw_axis, np.radians(yaw_delta))
        self.orientation = quaternion.cross(yaw_q, self.orientation)

        self._update_basis()

        pitch_q = _safe_quaternion(self.right, np.radians(pitch_delta))
        self.orientation = quaternion.cross(pitch_q, self.orientation)

        self.orientation = quaternion.normalise(self.orientation)
        self._update_basis()

    def process_roll(self, direction, dt):
        delta = 0.0
        if direction == "LEFT":
            delta = self.roll_speed * dt
        elif direction == "RIGHT":
            delta = -self.roll_speed * dt

        if abs(delta) < 1e-8:
            return

        self.roll = (self.roll + delta) % 360.0

        roll_q = _safe_quaternion(self.front, np.radians(delta))
        self.orientation = quaternion.cross(roll_q, self.orientation)
        self.orientation = quaternion.normalise(self.orientation)
        self._update_basis()

    def process_movement(self, direction, dt):
        velocity = self.speed * dt

        if direction == "FORWARD":
            self.position += self.front * velocity
        elif direction == "BACKWARD":
            self.position -= self.front * velocity
        elif direction == "LEFT":
            self.position -= self.right * velocity
        elif direction == "RIGHT":
            self.position += self.right * velocity
        elif direction == "UP":
            self.position += self.up * velocity
        elif direction == "DOWN":
            self.position -= self.up * velocity

        if self.min_radius is not None:
            dist = np.linalg.norm(self.position)
            if dist < self.min_radius:
                if dist > 1e-6:
                    self.position = normalize(self.position) * self.min_radius
                else:
                    self.position = np.array([0, 0, self.min_radius], dtype=np.float32)

    def enable_reference_alignment(self, enabled: bool):
        self.reference_alignment_enabled = enabled
        if enabled:
            self.roll = 0.0
            self._update_basis()
        else:
            self._rebuild_orientation()
            self._update_basis()

    def set_reference_up(self, up: np.ndarray):
        self.reference_up = normalize(up)
        if self.reference_alignment_enabled:
            self.roll = 0.0
            self._update_basis()
        else:
            self._rebuild_orientation()
            self._update_basis()

    def _realign_to_reference(self):
        ref_up = normalize(self.reference_up)
        forward = normalize(_apply_quaternion(self.orientation, np.array([0.0, 0.0, -1.0], dtype=np.float32)))

        right = np.cross(forward, ref_up)
        if np.linalg.norm(right) < 1e-6:
            right = np.cross(ref_up, self.right)
        right = normalize(right if np.linalg.norm(right) > 1e-6 else np.array([1.0, 0.0, 0.0], dtype=np.float32))

        forward = normalize(np.cross(right, ref_up))
        up = ref_up

        rotation_matrix = np.column_stack((right, up, -forward)).astype(np.float32)
        self.orientation = quaternion.normalise(quaternion.create_from_matrix(rotation_matrix))

        self.front = forward
        self.right = right
        self.up = up
