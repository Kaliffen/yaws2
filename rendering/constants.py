from dataclasses import dataclass, field
import numpy as np


# Default baseline values used to seed configurable parameters.
SUN_DIRECTION = np.array([0.22, 0.22, 0.71], dtype=np.float32)
SUN_POWER = 1.5
SCALAR = 1.0
# Base scale values for the planet and atmosphere (kilometers)
# Use a realistic Earth-sized radius so the horizon and curvature feel correct
# when flying close to the surface.
PLANET_RADIUS = 6371.0 * SCALAR

# Express atmospheric and cloud heights as percentages of the planet radius
# or atmosphere thickness so they automatically scale. A thinner 3% shell keeps
# the atmosphere more believable while still visible at a distance, and the
# cloud band lives comfortably within that shell.
ATMOSPHERE_THICKNESS_PERCENT = 4.0
ATMOSPHERE_THICKNESS_RATIO = ATMOSPHERE_THICKNESS_PERCENT / 100.0
_BASELINE_ATMOSPHERE_THICKNESS = PLANET_RADIUS * ATMOSPHERE_THICKNESS_RATIO
CLOUD_BASE_PERCENT = 45.0
CLOUD_LAYER_THICKNESS_PERCENT = 35.0
CLOUD_BASE_ALTITUDE_RATIO = CLOUD_BASE_PERCENT / 100.0
CLOUD_LAYER_THICKNESS_RATIO = CLOUD_LAYER_THICKNESS_PERCENT / 100.0

ATMOSPHERE_RADIUS = PLANET_RADIUS * (1.0 + ATMOSPHERE_THICKNESS_RATIO)

# Keep terrain displacement realistic relative to the planet scale to avoid
# exaggerated features, but still allow visible mountain ranges.
HEIGHT_SCALE = 432.2 * SCALAR

# Water parameters
# Interpret sea level as a world-space height offset instead of a fractional
# multiplier so the shader math stays consistent. A small positive offset keeps
# shallow coastlines without burying continents.
SEA_LEVEL = 0.0  # kilometers above the planet radius
# Slightly brighter water with a touch more scattering makes oceans stand out
# against land.
WATER_COLOR = np.array([0.02, 0.16, 0.24], dtype=np.float32)
WATER_ABSORPTION = 0.74
WATER_SCATTERING = 0.24

# Raymarch distances scale with the planet to ensure intersections are found
# reliably without overshooting. A longer distance avoids missing the planet
# when pulling far back for full-globe views.
MAX_RAY_DISTANCE_FACTOR = 3.0
MAX_RAY_DISTANCE = PLANET_RADIUS * MAX_RAY_DISTANCE_FACTOR

# Cloud parameters keep volumetric sampling anchored to the planet instead of the
# screen. A shallow layer near the surface produces convincing low-altitude
# clouds without spilling deep into the atmosphere.
_BASELINE_ATMOSPHERE_THICKNESS_RATIO = _BASELINE_ATMOSPHERE_THICKNESS / PLANET_RADIUS
_BASELINE_CLOUD_BASE_ALTITUDE = PLANET_RADIUS * _BASELINE_ATMOSPHERE_THICKNESS_RATIO * CLOUD_BASE_ALTITUDE_RATIO
_BASELINE_CLOUD_LAYER_THICKNESS = PLANET_RADIUS * _BASELINE_ATMOSPHERE_THICKNESS_RATIO * CLOUD_LAYER_THICKNESS_RATIO

CLOUD_BASE_ALTITUDE = _BASELINE_CLOUD_BASE_ALTITUDE
CLOUD_LAYER_THICKNESS = _BASELINE_CLOUD_LAYER_THICKNESS
CLOUD_COVERAGE = 0.44
CLOUD_DENSITY = 0.45
CLOUD_LIGHT_COLOR = np.array([1.0, 0.97, 0.94], dtype=np.float32)

# Raymarch controls
PLANET_MAX_STEPS = 320
PLANET_STEP_SCALE = 0.17
PLANET_MIN_STEP_FACTOR = 0.5

CLOUD_MAX_STEPS = 48
CLOUD_EXTINCTION = 0.55
CLOUD_PHASE_EXPONENT = 2.5
CLOUD_ANIMATION_SPEED = 0.006

# Planet orientation
TILT_DEGREES = 23.5
TIME_SPEED = 240.0


def _copy_vector(vec: np.ndarray) -> np.ndarray:
    return np.array(vec, dtype=np.float32)


@dataclass
class PlanetParameters:
    """Container for all tweakable planet rendering parameters."""

    sun_direction: np.ndarray = field(default_factory=lambda: _copy_vector(SUN_DIRECTION))
    sun_power: float = SUN_POWER
    planet_radius: float = PLANET_RADIUS
    atmosphere_thickness_percent: float = ATMOSPHERE_THICKNESS_PERCENT
    cloud_base_percent: float = CLOUD_BASE_PERCENT
    cloud_layer_thickness_percent: float = CLOUD_LAYER_THICKNESS_PERCENT
    atmosphere_radius: float = ATMOSPHERE_RADIUS
    height_scale: float = HEIGHT_SCALE
    sea_level: float = SEA_LEVEL
    water_color: np.ndarray = field(default_factory=lambda: _copy_vector(WATER_COLOR))
    water_absorption: float = WATER_ABSORPTION
    water_scattering: float = WATER_SCATTERING
    max_ray_distance: float = MAX_RAY_DISTANCE
    cloud_base_altitude: float = CLOUD_BASE_ALTITUDE
    cloud_layer_thickness: float = CLOUD_LAYER_THICKNESS
    cloud_coverage: float = CLOUD_COVERAGE
    cloud_density: float = CLOUD_DENSITY
    cloud_light_color: np.ndarray = field(default_factory=lambda: _copy_vector(CLOUD_LIGHT_COLOR))
    planet_max_steps: int = PLANET_MAX_STEPS
    planet_step_scale: float = PLANET_STEP_SCALE
    planet_min_step_factor: float = PLANET_MIN_STEP_FACTOR
    cloud_max_steps: int = CLOUD_MAX_STEPS
    cloud_extinction: float = CLOUD_EXTINCTION
    cloud_phase_exponent: float = CLOUD_PHASE_EXPONENT
    cloud_animation_speed: float = CLOUD_ANIMATION_SPEED
    tilt_degrees: float = TILT_DEGREES
    time_speed: float = TIME_SPEED

    def scale_with_planet_radius(self) -> None:
        atmosphere_thickness = self.planet_radius * (self.atmosphere_thickness_percent / 100.0)
        self.atmosphere_radius = self.planet_radius + atmosphere_thickness
        cloud_base_ratio = np.clip(self.cloud_base_percent / 100.0, 0.0, 1.0)
        cloud_thickness_ratio = np.clip(self.cloud_layer_thickness_percent / 100.0, 0.0, 1.0)
        max_thickness_ratio = max(0.0, 1.0 - cloud_base_ratio)
        cloud_thickness_ratio = min(cloud_thickness_ratio, max_thickness_ratio)

        self.cloud_base_altitude = atmosphere_thickness * cloud_base_ratio
        self.cloud_layer_thickness = atmosphere_thickness * cloud_thickness_ratio
        max_ray_distance_factor = (
            self.max_ray_distance / self.planet_radius
            if self.planet_radius > 0.0
            else MAX_RAY_DISTANCE_FACTOR
        )
        self.max_ray_distance = self.planet_radius * max_ray_distance_factor

    def copy(self) -> "PlanetParameters":
        return PlanetParameters(
            sun_direction=_copy_vector(self.sun_direction),
            planet_radius=self.planet_radius,
            atmosphere_thickness_percent=self.atmosphere_thickness_percent,
            cloud_base_percent=self.cloud_base_percent,
            cloud_layer_thickness_percent=self.cloud_layer_thickness_percent,
            atmosphere_radius=self.atmosphere_radius,
            height_scale=self.height_scale,
            sea_level=self.sea_level,
            water_color=_copy_vector(self.water_color),
            water_absorption=self.water_absorption,
            water_scattering=self.water_scattering,
            max_ray_distance=self.max_ray_distance,
            cloud_base_altitude=self.cloud_base_altitude,
            cloud_layer_thickness=self.cloud_layer_thickness,
            cloud_coverage=self.cloud_coverage,
            cloud_density=self.cloud_density,
            cloud_light_color=_copy_vector(self.cloud_light_color),
            planet_max_steps=self.planet_max_steps,
            planet_step_scale=self.planet_step_scale,
            planet_min_step_factor=self.planet_min_step_factor,
            cloud_max_steps=self.cloud_max_steps,
            cloud_extinction=self.cloud_extinction,
            cloud_phase_exponent=self.cloud_phase_exponent,
            cloud_animation_speed=self.cloud_animation_speed,
            sun_power=self.sun_power,
            tilt_degrees=self.tilt_degrees,
            time_speed=self.time_speed,
        )


def default_planet_parameters() -> PlanetParameters:
    params = PlanetParameters()
    params.scale_with_planet_radius()
    return params
