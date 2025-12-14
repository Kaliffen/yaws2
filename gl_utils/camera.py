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
        self.front = np.array([0.0, 0.0, -1.0], dtype=np.float32)
        self.right = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        self.up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        self.orientation = quaternion.create()
        self.speed = 5.0
        self.sensitivity = 0.1
        self.roll_speed = 90.0
        self.min_radius = None
        self.reference_up = WORLD_UP.copy()
        self.use_reference_up = True
        self.velocity = np.zeros(3, dtype=np.float32)
        self._rebuild_orientation()
        self.update_vectors()

    def set_reference_up(self, up_vector: np.ndarray):
        self.reference_up = normalize(up_vector)

    def enable_reference_alignment(self, enabled: bool):
        self.use_reference_up = enabled
        if enabled:
            self.roll = 0.0
            self._align_up_with_reference()

    def _rebuild_orientation(self):
        """Build an orientation quaternion from yaw/pitch state."""
        self.orientation = quaternion.create()

        yaw_q = _safe_quaternion(self.reference_up, np.radians(self.yaw))
        self.orientation = quaternion.cross(yaw_q, self.orientation)

        right_axis = _apply_quaternion(self.orientation, np.array([1.0, 0.0, 0.0], dtype=np.float32))
        pitch_q = _safe_quaternion(right_axis, np.radians(self.pitch))
        self.orientation = quaternion.cross(self.orientation, pitch_q)

        self.orientation = quaternion.normalise(self.orientation)

    def _align_up_with_reference(self):
        """Rotate the current orientation so its up matches the reference vector."""
        self.update_vectors()
        target_up = normalize(self.reference_up)
        current_up = self.up

        axis = np.cross(current_up, target_up)
        axis_len = np.linalg.norm(axis)
        dot_up = float(np.clip(np.dot(current_up, target_up), -1.0, 1.0))

        if axis_len < 1e-6:
            if dot_up < 0.0:
                axis = self.front
                angle = np.pi
            else:
                return
        else:
            angle = np.arccos(dot_up)

        alignment = _safe_quaternion(axis, angle)
        self.orientation = quaternion.normalise(quaternion.cross(alignment, self.orientation))
        self.update_vectors()

    def update_vectors(self):
        self.front = normalize(_apply_quaternion(self.orientation, np.array([0.0, 0.0, -1.0], dtype=np.float32)))
        self.right = normalize(_apply_quaternion(self.orientation, np.array([1.0, 0.0, 0.0], dtype=np.float32)))
        self.up = normalize(np.cross(self.right, self.front))

    def process_mouse(self, xoff, yoff):
        roll_rad = np.radians(-self.roll)
        cos_r = np.cos(roll_rad)
        sin_r = np.sin(roll_rad)

        rotated_x = xoff * cos_r - yoff * sin_r
        rotated_y = xoff * sin_r + yoff * cos_r

        xoff = rotated_x * self.sensitivity
        yoff = rotated_y * self.sensitivity

        if self.use_reference_up:
            prev_pitch = self.pitch
            self.yaw += xoff
            self.pitch = max(-89.0, min(89.0, self.pitch + yoff))

            yaw_delta = np.radians(xoff)
            pitch_delta = np.radians(self.pitch - prev_pitch)

            yaw_q = _safe_quaternion(self.reference_up, yaw_delta)
            self.orientation = quaternion.cross(yaw_q, self.orientation)

            self.update_vectors()
            pitch_axis = self.right
            pitch_q = _safe_quaternion(pitch_axis, pitch_delta)
            self.orientation = quaternion.cross(self.orientation, pitch_q)
        else:
            prev_pitch = self.pitch
            self.yaw += xoff
            self.pitch = max(-89.0, min(89.0, self.pitch + yoff))

            yaw_q = _safe_quaternion(self.up, np.radians(xoff))
            pitch_delta = np.radians(self.pitch - prev_pitch)
            pitch_q = _safe_quaternion(self.right, pitch_delta)

            self.orientation = quaternion.cross(self.orientation, yaw_q)
            self.orientation = quaternion.cross(self.orientation, pitch_q)

        self.orientation = quaternion.normalise(self.orientation)
        self.update_vectors()

    def process_roll(self, direction, dt):
        if self.use_reference_up:
            return

        delta = 0.0
        if direction == "LEFT":
            delta = self.roll_speed * dt
        elif direction == "RIGHT":
            delta = -self.roll_speed * dt

        if abs(delta) < 1e-8:
            return

        self.roll = (self.roll + delta) % 360.0

        roll_q = _safe_quaternion(self.front, np.radians(delta))
        self.orientation = quaternion.normalise(quaternion.cross(self.orientation, roll_q))
        self.update_vectors()

    def process_movement(self, direction, dt):
        velocity = self.speed * dt
        if direction == "FAST":
            velocity *= 5
            return
        if direction == "FORWARD":
            self.position += self.front * velocity
        if direction == "BACKWARD":
            self.position -= self.front * velocity
        if direction == "LEFT":
            self.position -= self.right * velocity
        if direction == "RIGHT":
            self.position += self.right * velocity

        if self.min_radius is not None:
            dist = np.linalg.norm(self.position)
            if dist < self.min_radius:
                if dist > 1e-6:
                    self.position = normalize(self.position) * self.min_radius
                else:
                    self.position = np.array([0, 0, self.min_radius], dtype=np.float32)
