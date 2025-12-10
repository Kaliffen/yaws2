from OpenGL.GL import *

from gl_utils.buffers import create_gbuffer
from rendering.constants import (
    ATMOSPHERE_RADIUS,
    HEIGHT_SCALE,
    MAX_RAY_DISTANCE,
    PLANET_RADIUS,
    SEA_LEVEL,
    SUN_DIRECTION,
    WATER_ABSORPTION,
    WATER_COLOR,
    WATER_SCATTERING,
)
from rendering.uniforms import set_float, set_int, set_vec2, set_vec3


class PlanetRenderer:
    def __init__(self, gbuffer_program, composite_program):
        self.gbuffer_program = gbuffer_program
        self.composite_program = composite_program
        self.gbuffer = None
        self.cam_pos = None

    def _ensure_gbuffer(self, width, height):
        if self.gbuffer and self.gbuffer["width"] == width and self.gbuffer["height"] == height:
            return

        self.gbuffer = create_gbuffer(width, height)

    def _bind_common_uniforms(self, program, width, height):
        set_vec3(program, "camPos", self.cam_pos)
        set_vec3(program, "sunDir", SUN_DIRECTION)
        set_float(program, "planetRadius", PLANET_RADIUS)
        set_float(program, "atmosphereRadius", ATMOSPHERE_RADIUS)
        set_float(program, "heightScale", HEIGHT_SCALE)
        set_float(program, "maxRayDistance", MAX_RAY_DISTANCE)
        set_float(program, "seaLevel", SEA_LEVEL)
        set_vec2(program, "resolution", (width, height))

    def render(self, cam_pos, cam_front, cam_right, cam_up, width, height, layer_visibility):
        self.cam_pos = cam_pos
        self._ensure_gbuffer(width, height)

        # Pass 1: populate G-buffer
        glBindFramebuffer(GL_FRAMEBUFFER, self.gbuffer["fbo"])
        glViewport(0, 0, width, height)
        glClearColor(0.0, 0.0, 0.0, 1.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glUseProgram(self.gbuffer_program)
        set_vec3(self.gbuffer_program, "camPos", cam_pos)
        set_vec3(self.gbuffer_program, "camForward", cam_front)
        set_vec3(self.gbuffer_program, "camRight", cam_right)
        set_vec3(self.gbuffer_program, "camUp", cam_up)
        set_vec3(self.gbuffer_program, "sunDir", SUN_DIRECTION)
        set_float(self.gbuffer_program, "planetRadius", PLANET_RADIUS)
        set_float(self.gbuffer_program, "atmosphereRadius", ATMOSPHERE_RADIUS)
        set_float(self.gbuffer_program, "heightScale", HEIGHT_SCALE)
        set_float(self.gbuffer_program, "maxRayDistance", MAX_RAY_DISTANCE)
        set_float(self.gbuffer_program, "seaLevel", SEA_LEVEL)
        set_vec3(self.gbuffer_program, "waterColor", WATER_COLOR)
        set_float(self.gbuffer_program, "waterAbsorption", WATER_ABSORPTION)
        set_float(self.gbuffer_program, "waterScattering", WATER_SCATTERING)
        set_vec2(self.gbuffer_program, "resolution", (width, height))
        set_float(self.gbuffer_program, "aspect", float(width) / float(height))

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 2: composite and debug layers
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glUseProgram(self.composite_program)
        self._bind_common_uniforms(self.composite_program, width, height)

        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["position"])
        set_int(self.composite_program, "gPositionHeight", 0)

        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["normal"])
        set_int(self.composite_program, "gNormalFlags", 1)

        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["material"])
        set_int(self.composite_program, "gMaterial", 2)

        for i, visible in enumerate(layer_visibility):
            set_int(self.composite_program, f"showLayer[{i}]", 1 if visible else 0)

        glDrawArrays(GL_TRIANGLES, 0, 6)
