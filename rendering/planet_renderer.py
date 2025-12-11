from OpenGL.GL import *

from gl_utils.buffers import create_color_fbo, create_gbuffer
from rendering.constants import PlanetParameters
from rendering.uniforms import set_float, set_int, set_vec2, set_vec3


class PlanetRenderer:
    def __init__(self, gbuffer_program, lighting_program, atmosphere_program, cloud_program, composite_program, parameters: PlanetParameters):
        self.gbuffer_program = gbuffer_program
        self.lighting_program = lighting_program
        self.atmosphere_program = atmosphere_program
        self.cloud_program = cloud_program
        self.composite_program = composite_program
        self.parameters = parameters
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
        params = self.parameters
        set_vec3(program, "camPos", self.cam_pos)
        set_vec3(program, "camForward", self.cam_forward)
        set_vec3(program, "camRight", self.cam_right)
        set_vec3(program, "camUp", self.cam_up)
        set_vec3(program, "sunDir", params.sun_direction)
        set_float(program, "planetRadius", params.planet_radius)
        set_float(program, "atmosphereRadius", params.atmosphere_radius)
        set_float(program, "heightScale", params.height_scale)
        set_float(program, "maxRayDistance", params.max_ray_distance)
        set_float(program, "seaLevel", params.sea_level)
        set_float(program, "cloudBaseAltitude", params.cloud_base_altitude)
        set_float(program, "cloudLayerThickness", params.cloud_layer_thickness)
        set_float(program, "cloudCoverage", params.cloud_coverage)
        set_float(program, "cloudDensity", params.cloud_density)
        set_vec3(program, "cloudLightColor", params.cloud_light_color)
        set_vec2(program, "resolution", (width, height))
        set_float(program, "aspect", float(width) / float(height))

        set_vec3(program, "waterColor", params.water_color)
        set_float(program, "waterAbsorption", params.water_absorption)
        set_float(program, "waterScattering", params.water_scattering)

    def render(
        self,
        cam_pos,
        cam_front,
        cam_right,
        cam_up,
        width,
        height,
        layer_visibility,
        target_fbo=0,
    ):
        self.cam_pos = cam_pos
        self.cam_forward = cam_front
        self.cam_right = cam_right
        self.cam_up = cam_up
        self._ensure_gbuffer(width, height)
        self._ensure_color_targets(width, height)

        # Pass 1: populate G-buffer (depth-tested)
        glEnable(GL_DEPTH_TEST)
        glDepthMask(GL_TRUE)
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

        glDisable(GL_DEPTH_TEST)
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
        glBindFramebuffer(GL_FRAMEBUFFER, target_fbo)
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
