import numpy as np

WORLD_UP = np.array([0.0, 1.0, 0.0], dtype=np.float32)


def normalize(v):
    norm = np.linalg.norm(v)
    if norm < 1e-8:
        return np.array(v, dtype=np.float32)
    return (v / norm).astype(np.float32)


def _rotation_matrix(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    axis = normalize(axis)
    c = np.cos(angle_rad)
    s = np.sin(angle_rad)
    t = 1.0 - c
    x, y, z = axis
    return np.array(
        [
            [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
            [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
            [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
        ],
        dtype=np.float32,
    )


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
        self.speed = 5.0
        self.sensitivity = 0.1
        self.roll_speed = 90.0
        self.min_radius = None
        self.reference_up = WORLD_UP.copy()
        self.use_reference_up = True
        self.velocity = np.zeros(3, dtype=np.float32)
        self.update_vectors()

    def set_reference_up(self, up_vector: np.ndarray):
        self.reference_up = normalize(up_vector)

    def enable_reference_alignment(self, enabled: bool):
        self.use_reference_up = enabled
        if enabled:
            self.roll = 0.0

    def update_vectors(self):
        yaw_r = np.radians(self.yaw)
        pitch_r = np.radians(self.pitch)

        fx = np.cos(yaw_r) * np.cos(pitch_r)
        fy = np.sin(pitch_r)
        fz = np.sin(yaw_r) * np.cos(pitch_r)

        base_front = normalize(np.array([fx, fy, fz], dtype=np.float32))
        base_right = normalize(np.cross(base_front, WORLD_UP))
        base_up = normalize(np.cross(base_right, base_front))

        if self.use_reference_up:
            target_up = normalize(self.reference_up)
            alignment_axis = np.cross(WORLD_UP, target_up)
            alignment_axis_norm = np.linalg.norm(alignment_axis)
            dot_up = float(np.clip(np.dot(WORLD_UP, target_up), -1.0, 1.0))

            if alignment_axis_norm < 1e-6:
                if dot_up < 0.0:
                    alignment_axis = np.array([1.0, 0.0, 0.0], dtype=np.float32)
                    angle = np.pi
                else:
                    self.front = base_front
                    self.right = base_right
                    self.up = base_up
                    return
            else:
                alignment_axis = alignment_axis / alignment_axis_norm
                angle = np.arccos(dot_up)

            rotation = _rotation_matrix(alignment_axis, angle)
            self.front = normalize(rotation @ base_front)
            self.right = normalize(rotation @ base_right)
            self.up = normalize(rotation @ base_up)
            return

        roll_rotation = _rotation_matrix(base_front, np.radians(self.roll))
        self.front = base_front
        self.right = normalize(roll_rotation @ base_right)
        self.up = normalize(roll_rotation @ base_up)

    def process_mouse(self, xoff, yoff):
        roll_rad = np.radians(self.roll)
        cos_r = np.cos(roll_rad)
        sin_r = np.sin(roll_rad)

        rotated_x = xoff * cos_r - yoff * sin_r
        rotated_y = xoff * sin_r + yoff * cos_r

        xoff = rotated_x * self.sensitivity
        yoff = rotated_y * self.sensitivity

        self.yaw += xoff
        self.pitch += yoff

        self.pitch = max(-89.0, min(89.0, self.pitch))

        self.update_vectors()

    def process_roll(self, direction, dt):
        if direction == "LEFT":
            self.roll += self.roll_speed * dt
        elif direction == "RIGHT":
            self.roll -= self.roll_speed * dt

        self.roll = (self.roll + 360.0) % 360.0
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
