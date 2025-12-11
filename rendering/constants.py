import numpy as np
from dataclasses import dataclass, field


@dataclass
class PlanetParameters:
    sun_direction: np.ndarray = field(
        default_factory=lambda: np.array([0.62, 0.32, 0.71], dtype=np.float32)
    )
    planet_radius: float = 6371.0
    atmosphere_radius: float | None = None
    height_scale: float = 532.2
    sea_level: float = -35.0
    water_color: np.ndarray = field(
        default_factory=lambda: np.array([0.02, 0.16, 0.34], dtype=np.float32)
    )
    water_absorption: float = 0.24
    water_scattering: float = 0.14
    max_ray_distance: float | None = None
    cloud_base_altitude: float = 6.5
    cloud_layer_thickness: float = 8.0
    cloud_coverage: float = 0.62
    cloud_density: float = 0.85
    cloud_light_color: np.ndarray = field(
        default_factory=lambda: np.array([1.0, 0.97, 0.94], dtype=np.float32)
    )

    def __post_init__(self):
        if self.atmosphere_radius is None:
            self.atmosphere_radius = self.planet_radius + 210.0
        if self.max_ray_distance is None:
            self.max_ray_distance = self.planet_radius * 3.0


# Preserve direct constant-style defaults for modules that still import them.
DEFAULT_PARAMETERS = PlanetParameters()

SUN_DIRECTION = DEFAULT_PARAMETERS.sun_direction
PLANET_RADIUS = DEFAULT_PARAMETERS.planet_radius
ATMOSPHERE_RADIUS = DEFAULT_PARAMETERS.atmosphere_radius
HEIGHT_SCALE = DEFAULT_PARAMETERS.height_scale
SEA_LEVEL = DEFAULT_PARAMETERS.sea_level
WATER_COLOR = DEFAULT_PARAMETERS.water_color
WATER_ABSORPTION = DEFAULT_PARAMETERS.water_absorption
WATER_SCATTERING = DEFAULT_PARAMETERS.water_scattering
MAX_RAY_DISTANCE = DEFAULT_PARAMETERS.max_ray_distance
CLOUD_BASE_ALTITUDE = DEFAULT_PARAMETERS.cloud_base_altitude
CLOUD_LAYER_THICKNESS = DEFAULT_PARAMETERS.cloud_layer_thickness
CLOUD_COVERAGE = DEFAULT_PARAMETERS.cloud_coverage
CLOUD_DENSITY = DEFAULT_PARAMETERS.cloud_density
CLOUD_LIGHT_COLOR = DEFAULT_PARAMETERS.cloud_light_color
