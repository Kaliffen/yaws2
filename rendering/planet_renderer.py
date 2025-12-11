from OpenGL.GL import *

from gl_utils.buffers import create_color_fbo, create_gbuffer
from rendering.constants import (
    ATMOSPHERE_RADIUS,
    CLOUD_BASE_ALTITUDE,
    CLOUD_COVERAGE,
    CLOUD_DENSITY,
    CLOUD_LAYER_THICKNESS,
    CLOUD_LIGHT_COLOR,
    HEIGHT_SCALE,
    MAX_RAY_DISTANCE,
    PLANET_RADIUS,
    SEA_LEVEL,
    SUN_DIRECTION,
    WATER_COLOR,
)
from rendering.uniforms import set_float, set_int, set_vec2, set_vec3


class PlanetRenderer:
    def __init__(self, gbuffer_program, lighting_program, atmosphere_program, cloud_program, composite_program):
        self.gbuffer_program = gbuffer_program
        self.lighting_program = lighting_program
        self.atmosphere_program = atmosphere_program
        self.cloud_program = cloud_program
        self.composite_program = composite_program
        self.gbuffer = None
        self.lighting_buffer = None
        self.atmosphere_buffer = None
        self.cloud_buffer = None
        self.cam_pos = None
        self.cam_forward = None
        self.cam_right = None
        self.cam_up = None

    def _ensure_gbuffer(self, width, height):
        if self.gbuffer and self.gbuffer["width"] == width and self.gbuffer["height"] == height:
            return

        self.gbuffer = create_gbuffer(width, height)

    def _ensure_color_targets(self, width, height):
        needs_resize = (
            not self.lighting_buffer
            or self.lighting_buffer["width"] != width
            or self.lighting_buffer["height"] != height
        )
        if not needs_resize:
            return

        self.lighting_buffer = create_color_fbo(width, height)
        self.atmosphere_buffer = create_color_fbo(width, height)
        self.cloud_buffer = create_color_fbo(width, height)

    def _bind_common_uniforms(self, program, width, height):
        set_vec3(program, "camPos", self.cam_pos)
        set_vec3(program, "camForward", self.cam_forward)
        set_vec3(program, "camRight", self.cam_right)
        set_vec3(program, "camUp", self.cam_up)
        set_vec3(program, "sunDir", SUN_DIRECTION)
        set_float(program, "planetRadius", PLANET_RADIUS)
        set_float(program, "atmosphereRadius", ATMOSPHERE_RADIUS)
        set_float(program, "heightScale", HEIGHT_SCALE)
        set_float(program, "maxRayDistance", MAX_RAY_DISTANCE)
        set_float(program, "seaLevel", SEA_LEVEL)
        set_float(program, "cloudBaseAltitude", CLOUD_BASE_ALTITUDE)
        set_float(program, "cloudLayerThickness", CLOUD_LAYER_THICKNESS)
        set_float(program, "cloudCoverage", CLOUD_COVERAGE)
        set_float(program, "cloudDensity", CLOUD_DENSITY)
        set_vec3(program, "cloudLightColor", CLOUD_LIGHT_COLOR)
        set_vec2(program, "resolution", (width, height))
        set_float(program, "aspect", float(width) / float(height))

        set_vec3(program, "waterColor", WATER_COLOR)

    def render(self, cam_pos, cam_front, cam_right, cam_up, width, height, layer_visibility):
        self.cam_pos = cam_pos
        self.cam_forward = cam_front
        self.cam_right = cam_right
        self.cam_up = cam_up
        self._ensure_gbuffer(width, height)
        self._ensure_color_targets(width, height)

        # Pass 1: populate G-buffer
        glBindFramebuffer(GL_FRAMEBUFFER, self.gbuffer["fbo"])
        glViewport(0, 0, width, height)
        glClearColor(0.0, 0.0, 0.0, 1.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glUseProgram(self.gbuffer_program)
        self._bind_common_uniforms(self.gbuffer_program, width, height)

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 2: lighting
        glBindFramebuffer(GL_FRAMEBUFFER, self.lighting_buffer["fbo"])
        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT)

        glUseProgram(self.lighting_program)
        self._bind_common_uniforms(self.lighting_program, width, height)

        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["position"])
        set_int(self.lighting_program, "gPositionHeight", 0)

        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["normal"])
        set_int(self.lighting_program, "gNormalFlags", 1)

        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["material"])
        set_int(self.lighting_program, "gMaterial", 2)

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 3: atmosphere
        glBindFramebuffer(GL_FRAMEBUFFER, self.atmosphere_buffer["fbo"])
        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT)

        glUseProgram(self.atmosphere_program)
        self._bind_common_uniforms(self.atmosphere_program, width, height)

        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["position"])
        set_int(self.atmosphere_program, "gPositionHeight", 0)

        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["normal"])
        set_int(self.atmosphere_program, "gNormalFlags", 1)

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 4: volumetric clouds
        glBindFramebuffer(GL_FRAMEBUFFER, self.cloud_buffer["fbo"])
        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT)

        glUseProgram(self.cloud_program)
        self._bind_common_uniforms(self.cloud_program, width, height)

        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["position"])
        set_int(self.cloud_program, "gPositionHeight", 0)

        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["normal"])
        set_int(self.cloud_program, "gNormalFlags", 1)

        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["material"])
        set_int(self.cloud_program, "gMaterial", 2)

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 5: composite and debug layers
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

        glActiveTexture(GL_TEXTURE3)
        glBindTexture(GL_TEXTURE_2D, self.lighting_buffer["textures"][0])
        set_int(self.composite_program, "lightingTex", 3)

        glActiveTexture(GL_TEXTURE4)
        glBindTexture(GL_TEXTURE_2D, self.atmosphere_buffer["textures"][0])
        set_int(self.composite_program, "atmosphereTex", 4)

        glActiveTexture(GL_TEXTURE5)
        glBindTexture(GL_TEXTURE_2D, self.cloud_buffer["textures"][0])
        set_int(self.composite_program, "cloudTex", 5)

        for i, visible in enumerate(layer_visibility):
            set_int(self.composite_program, f"showLayer[{i}]", 1 if visible else 0)

        glDrawArrays(GL_TRIANGLES, 0, 6)
