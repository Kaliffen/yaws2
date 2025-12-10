from OpenGL.GL import *

from rendering.constants import SUN_DIRECTION
from rendering.uniforms import set_vec3, set_float


class PlanetRenderer:
    def __init__(self, program):
        self.program = program

    def render(self, cam_pos, cam_front, cam_right, cam_up, width, height, dt, t):
        glUseProgram(self.program)

        set_vec3(self.program, "camPos", cam_pos)
        set_vec3(self.program, "camForward", cam_front)
        set_vec3(self.program, "camRight", cam_right)
        set_vec3(self.program, "camUp", cam_up)
        set_vec3(self.program, "sunDir", SUN_DIRECTION)

        set_float(self.program, "time", float(t))
        set_float(self.program, "dt", float(dt))
        set_float(self.program, "aspect", float(width) / float(height))
