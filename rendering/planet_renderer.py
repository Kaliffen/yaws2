from OpenGL.GL import *
import numpy as np

from gl_utils.buffers import create_3d_texture, create_color_fbo, create_gbuffer
from rendering.constants import PlanetParameters
from utils.time import compute_sun_direction
from rendering.uniforms import set_float, set_int, set_mat3, set_vec2, set_vec3


class PlanetRenderer:
    def __init__(
        self,
        gbuffer_program,
        lighting_program,
        atmosphere_program,
        cloud_program,
        composite_program,
        surface_info_program,
        cloud_noise_program,
        parameters: PlanetParameters,
    ):
        self.gbuffer_program = gbuffer_program
        self.lighting_program = lighting_program
        self.atmosphere_program = atmosphere_program
        self.cloud_program = cloud_program
        self.composite_program = composite_program
        self.surface_info_program = surface_info_program
        self.cloud_noise_program = cloud_noise_program
        self.parameters = parameters
        self.gbuffer = None
        self.lighting_buffer = None
        self.atmosphere_buffer = None
        self.cloud_buffer = None
        self.surface_info_buffer = None
        self.coverage_noise_tex = None
        self.shape_noise_tex = None
        self.cloud_noise_size = 128
        self.cam_pos = None
        self.cam_forward = None
        self.cam_right = None
        self.cam_up = None
        self.spin_angle_deg = 0.0
        self.seasonal_tilt_deg = 0.0
        self.planet_to_world = np.identity(3, dtype=np.float32)
        self.world_to_planet = np.identity(3, dtype=np.float32)
        self.time_seconds = 0.0
        self.sun_direction = np.array(parameters.sun_direction, dtype=np.float32)

    def _ensure_surface_info_buffer(self):
        if self.surface_info_buffer is not None:
            return

        self.surface_info_buffer = glGenBuffers(1)
        glBindBuffer(GL_SHADER_STORAGE_BUFFER, self.surface_info_buffer)
        glBufferData(GL_SHADER_STORAGE_BUFFER, 8 * 4, None, GL_DYNAMIC_READ)
        glBindBuffer(GL_SHADER_STORAGE_BUFFER, 0)

    def _rotation_matrix_from_axis(self, axis: np.ndarray, angle_rad: float) -> np.ndarray:
        axis = axis / np.linalg.norm(axis)
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

    def _update_rotation_matrices(self) -> None:
        self.seasonal_tilt_deg = self.parameters.tilt_degrees
        tilt_rad = np.deg2rad(self.seasonal_tilt_deg)
        tilt_matrix = np.array(
            [[1.0, 0.0, 0.0], [0.0, np.cos(tilt_rad), -np.sin(tilt_rad)], [0.0, np.sin(tilt_rad), np.cos(tilt_rad)]],
            dtype=np.float32,
        )
        self.planet_to_world = tilt_matrix
        self.world_to_planet = self.planet_to_world.T

    def _update_sun_direction(self, day_fraction: float, year_fraction: float) -> None:
        self.sun_direction = compute_sun_direction(day_fraction, year_fraction, self.parameters.tilt_degrees)

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

    def _ensure_cloud_noise_lut(self):
        if self.cloud_noise_program is None:
            return

        if self.coverage_noise_tex and self.shape_noise_tex:
            return

        size = self.cloud_noise_size
        self.coverage_noise_tex = create_3d_texture(size, size, size)
        self.shape_noise_tex = create_3d_texture(size, size, size)

        glUseProgram(self.cloud_noise_program)
        loc = glGetUniformLocation(self.cloud_noise_program, "volumeSize")
        glUniform3i(loc, size, size, size)

        glBindImageTexture(0, self.coverage_noise_tex, 0, GL_TRUE, 0, GL_WRITE_ONLY, GL_RGBA16F)
        glBindImageTexture(1, self.shape_noise_tex, 0, GL_TRUE, 0, GL_WRITE_ONLY, GL_RGBA16F)

        group_size = 4
        glDispatchCompute((size + group_size - 1) // group_size, (size + group_size - 1) // group_size, (size + group_size - 1) // group_size)
        glMemoryBarrier(GL_SHADER_IMAGE_ACCESS_BARRIER_BIT | GL_TEXTURE_FETCH_BARRIER_BIT)

    def _bind_coverage_texture(self, program, unit):
        if self.coverage_noise_tex is None:
            return

        glActiveTexture(GL_TEXTURE0 + unit)
        glBindTexture(GL_TEXTURE_3D, self.coverage_noise_tex)
        set_int(program, "coverageNoiseTex", unit)

    def _bind_cloud_noise_textures(self, program, coverage_unit=4, shape_unit=5):
        if self.coverage_noise_tex is None or self.shape_noise_tex is None:
            return

        self._bind_coverage_texture(program, coverage_unit)
        glActiveTexture(GL_TEXTURE0 + shape_unit)
        glBindTexture(GL_TEXTURE_3D, self.shape_noise_tex)
        set_int(program, "shapeNoiseTex", shape_unit)

    def _bind_common_uniforms(self, program, width, height):
        set_vec3(program, "camPos", self.cam_pos)
        set_vec3(program, "camForward", self.cam_forward)
        set_vec3(program, "camRight", self.cam_right)
        set_vec3(program, "camUp", self.cam_up)
        set_vec3(program, "sunDir", self.sun_direction)
        set_float(program, "sunPower", self.parameters.sun_power)
        set_float(program, "planetRadius", self.parameters.planet_radius)
        set_float(program, "atmosphereRadius", self.parameters.atmosphere_radius)
        set_float(program, "heightScale", self.parameters.height_scale)
        set_float(program, "maxRayDistance", self.parameters.max_ray_distance)
        set_float(program, "seaLevel", self.parameters.sea_level)
        set_float(program, "cloudBaseAltitude", self.parameters.cloud_base_altitude)
        set_float(program, "cloudLayerThickness", self.parameters.cloud_layer_thickness)
        set_float(program, "cloudCoverage", self.parameters.cloud_coverage)
        set_float(program, "cloudDensity", self.parameters.cloud_density)
        set_float(program, "cloudAnimationSpeed", self.parameters.cloud_animation_speed)
        set_vec3(program, "cloudLightColor", self.parameters.cloud_light_color)
        set_vec2(program, "resolution", (width, height))
        set_float(program, "aspect", float(width) / float(height))
        set_float(program, "timeSeconds", self.time_seconds)

        set_vec3(program, "waterColor", self.parameters.water_color)
        set_float(program, "waterAbsorption", self.parameters.water_absorption)
        set_float(program, "waterScattering", self.parameters.water_scattering)
        set_mat3(program, "planetToWorld", self.planet_to_world)
        set_mat3(program, "worldToPlanet", self.world_to_planet)

    def prepare_frame_state(self, calendar_state):
        self.time_seconds = calendar_state.elapsed_seconds
        self._update_rotation_matrices()
        self._update_sun_direction(calendar_state.day_fraction, calendar_state.year_fraction)

    def update_parameters(self, parameters: PlanetParameters):
        self.parameters = parameters
        self.sun_direction = np.array(parameters.sun_direction, dtype=np.float32)

    def query_surface_info(self, query_pos, min_altitude_offset=0.0):
        if self.surface_info_program is None:
            return None

        self._ensure_surface_info_buffer()

        glUseProgram(self.surface_info_program)
        set_vec3(self.surface_info_program, "queryPosition", query_pos)
        set_float(self.surface_info_program, "planetRadius", self.parameters.planet_radius)
        set_float(self.surface_info_program, "heightScale", self.parameters.height_scale)
        set_float(self.surface_info_program, "seaLevel", self.parameters.sea_level)
        set_mat3(self.surface_info_program, "worldToPlanet", self.world_to_planet)
        set_float(self.surface_info_program, "minAltitudeOffset", float(min_altitude_offset))

        glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, self.surface_info_buffer)
        glDispatchCompute(1, 1, 1)
        glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT)

        glBindBuffer(GL_SHADER_STORAGE_BUFFER, self.surface_info_buffer)
        raw = glGetBufferSubData(GL_SHADER_STORAGE_BUFFER, 0, 8 * 4)
        glBindBuffer(GL_SHADER_STORAGE_BUFFER, 0)

        data = np.frombuffer(raw, dtype=np.float32)
        normal = data[0:3]
        surface_radius = float(data[3])
        altitude = float(data[4])
        terrain_height = float(data[5])
        clamped_radius = float(data[6])

        return {
            "normal": normal,
            "surface_radius": surface_radius,
            "terrain_height": terrain_height,
            "altitude": altitude,
            "clamped_radius": clamped_radius,
        }

    def render(self, cam_pos, cam_front, cam_right, cam_up, width, height, debug_level, calendar_state):
        self.cam_pos = cam_pos
        self.cam_forward = cam_front
        self.cam_right = cam_right
        self.cam_up = cam_up
        self.time_seconds = calendar_state.elapsed_seconds
        self._update_rotation_matrices()
        self._update_sun_direction(calendar_state.day_fraction, calendar_state.year_fraction)
        self._ensure_gbuffer(width, height)
        self._ensure_color_targets(width, height)
        self._ensure_cloud_noise_lut()

        # Pass 1: populate G-buffer
        glBindFramebuffer(GL_FRAMEBUFFER, self.gbuffer["fbo"])
        glViewport(0, 0, width, height)
        glClearColor(0.0, 0.0, 0.0, 1.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glUseProgram(self.gbuffer_program)
        self._bind_common_uniforms(self.gbuffer_program, width, height)
        set_int(self.gbuffer_program, "planetMaxSteps", self.parameters.planet_max_steps)
        set_float(self.gbuffer_program, "planetStepScale", self.parameters.planet_step_scale)
        set_float(self.gbuffer_program, "planetMinStepFactor", self.parameters.planet_min_step_factor)
        self._bind_cloud_noise_textures(self.gbuffer_program, coverage_unit=4, shape_unit=5)

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

        glActiveTexture(GL_TEXTURE3)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["view_data"])
        set_int(self.lighting_program, "gViewData", 3)

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

        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["view_data"])
        set_int(self.atmosphere_program, "gViewData", 2)

        glDrawArrays(GL_TRIANGLES, 0, 6)

        # Pass 4: volumetric clouds
        glBindFramebuffer(GL_FRAMEBUFFER, self.cloud_buffer["fbo"])
        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT)

        glUseProgram(self.cloud_program)
        self._bind_common_uniforms(self.cloud_program, width, height)
        set_int(self.cloud_program, "cloudMaxSteps", self.parameters.cloud_max_steps)
        set_float(self.cloud_program, "cloudExtinction", self.parameters.cloud_extinction)
        set_float(self.cloud_program, "cloudPhaseExponent", self.parameters.cloud_phase_exponent)

        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["position"])
        set_int(self.cloud_program, "gPositionHeight", 0)

        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["normal"])
        set_int(self.cloud_program, "gNormalFlags", 1)

        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["material"])
        set_int(self.cloud_program, "gMaterial", 2)

        glActiveTexture(GL_TEXTURE3)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["view_data"])
        set_int(self.cloud_program, "gViewData", 3)
        self._bind_cloud_noise_textures(self.cloud_program, coverage_unit=4, shape_unit=5)

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

        glActiveTexture(GL_TEXTURE6)
        glBindTexture(GL_TEXTURE_2D, self.gbuffer["view_data"])
        set_int(self.composite_program, "gViewData", 6)

        set_int(self.composite_program, "debugLevel", debug_level)

        glDrawArrays(GL_TRIANGLES, 0, 6)
