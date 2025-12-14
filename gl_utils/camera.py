import json
import math
from pyrr import Vector3, Quaternion, matrix44, vector


class QuaternionCamera:
    def __init__(
        self,
        position=(0.0, 0.0, 5.0),
        speed=2.5,
        sensitivity=0.1,
        size=(800.0, 600.0),
        near=0.1,
        far=1000.0,
        fovy=65.0,
    ):
        self.perspective = {
            "width": size[0],
            "height": size[1],
            "near": near,
            "far": far,
            "fovy": fovy,
        }
        self.position = Vector3(position, dtype="f")
        self.world_up = Vector3([0.0, 1.0, 0.0], dtype="f")
        self.speed = speed
        self.sensitivity = sensitivity
        self.rotation = Quaternion([0.0, 0.0, 0.0, 1.0])

        self.update_camera_vectors()

    @property
    def fov_degrees(self):
        return float(self.perspective["fovy"])

    @fov_degrees.setter
    def fov_degrees(self, value):
        self.perspective["fovy"] = float(value)

    def print_state(self):
        """Return the state of the camera as a JSON string."""
        state = {
            "position": self.position.tolist(),
            "speed": self.speed,
            "sensitivity": self.sensitivity,
            "perspective": self.perspective,
            "rotation": self.rotation.tolist(),
        }
        return json.dumps(state)

    def load_state(self, state):
        self.position = Vector3(state["position"], dtype="f")
        self.speed = state["speed"]
        self.sensitivity = state["sensitivity"]
        self.perspective = state["perspective"]
        self.rotation = Quaternion(state["rotation"])
        self.update_camera_vectors()

    def update_camera_vectors(self):
        """Update direction vectors based on the quaternion rotation."""
        self.front = vector.normalize(self.rotation * Vector3([0.0, 0.0, -1.0]))
        self.right = vector.normalize(self.rotation * Vector3([1.0, 0.0, 0.0]))
        self.up = vector.normalize(self.rotation * Vector3([0.0, 1.0, 0.0]))

    def get_view_matrix(self):
        """Create a view matrix using the position and quaternion-based orientation."""
        target = self.position + self.front
        return matrix44.create_look_at(self.position, target, self.up)

    def get_projection_matrix(self):
        return matrix44.create_perspective_projection_matrix(
            self.perspective["fovy"],
            self.perspective["width"] / self.perspective["height"],
            self.perspective["near"],
            self.perspective["far"],
        )

    def move(self, direction, delta_time, boost=False, turbo=False):
        """Move the camera in the specified direction."""
        camera_speed = self.speed * (10.0 if boost else 1.0) * (4 if turbo else 1.0) * delta_time

        if direction == "FORWARD":
            self.position += camera_speed * self.front
        elif direction == "BACKWARD":
            self.position -= camera_speed * self.front
        elif direction == "LEFT":
            self.position -= camera_speed * self.right
        elif direction == "RIGHT":
            self.position += camera_speed * self.right
        elif direction == "UP":
            self.position += camera_speed * self.up
        elif direction == "DOWN":
            self.position -= camera_speed * self.up

    def rotate(self, x_offset, y_offset):
        """Rotate the camera based on mouse movement."""
        x_offset *= self.sensitivity
        y_offset *= self.sensitivity

        yaw_offset = Quaternion.from_y_rotation(-math.radians(x_offset))
        pitch_offset = Quaternion.from_x_rotation(-math.radians(y_offset))

        self.rotation = self.rotation * pitch_offset * yaw_offset
        self.rotation = self.rotation.normalised
        self.update_camera_vectors()

    def adjust_roll(self, roll_offset):
        """Adjust the camera roll."""
        roll_quat = Quaternion.from_z_rotation(math.radians(roll_offset * self.sensitivity))
        self.rotation = self.rotation * roll_quat
        self.rotation = self.rotation.normalised
        self.update_camera_vectors()

    def handle_keyboard_input(self, key, delta_time, boost=False, turbo=False):
        """Handle keyboard input for movement and roll adjustment."""
        if key in ["FORWARD", "BACKWARD", "LEFT", "RIGHT", "UP", "DOWN"]:
            self.move(key, delta_time, boost, turbo)
        elif key == "ROLL_LEFT":
            self.adjust_roll(-10.0)
        elif key == "ROLL_RIGHT":
            self.adjust_roll(10.0)

    def on_window_focus(self, focused):
        """Handle window focus changes."""
        if not focused:
            self.last_mouse_pos = None
        else:
            self.last_mouse_pos = None
