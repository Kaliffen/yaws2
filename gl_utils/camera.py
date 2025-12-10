import numpy as np


def normalize(v):
    return v / np.linalg.norm(v)


class FPSCamera:
    def __init__(self, position, yaw, pitch):
        self.position = position.astype(np.float32)
        self.yaw = yaw
        self.pitch = pitch
        self.front = np.array([0, 0, -1], dtype=np.float32)
        self.right = np.array([1, 0, 0], dtype=np.float32)
        self.up = np.array([0, 1, 0], dtype=np.float32)
        self.speed = 5.0
        self.sensitivity = 0.1
        self.update_vectors()

    def update_vectors(self):
        yaw_r = np.radians(self.yaw)
        pitch_r = np.radians(self.pitch)

        fx = np.cos(yaw_r) * np.cos(pitch_r)
        fy = np.sin(pitch_r)
        fz = np.sin(yaw_r) * np.cos(pitch_r)

        self.front = normalize(np.array([fx, fy, fz], dtype=np.float32))
        self.right = normalize(np.cross(self.front, np.array([0, 1, 0], dtype=np.float32)))
        self.up = normalize(np.cross(self.right, self.front))

    def process_mouse(self, xoff, yoff):
        xoff *= self.sensitivity
        yoff *= self.sensitivity

        self.yaw += xoff
        self.pitch += yoff

        self.pitch = max(-89.0, min(89.0, self.pitch))

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
