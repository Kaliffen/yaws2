import numpy as np

SUN_DIRECTION = np.array([0.6, 0.4, 0.7], dtype=np.float32)

# Base scale values for the planet and atmosphere (kilometers)
# Use a realistic Earth-sized radius so the horizon and curvature feel correct
# when flying close to the surface.
PLANET_RADIUS = 6371.0

# Keep a thin atmospheric shell around the surface (~120 km thick).
ATMOSPHERE_RADIUS = PLANET_RADIUS + 120.0

# Keep terrain displacement realistic relative to the planet scale to avoid
# exaggerated features.
HEIGHT_SCALE = 9.5

# Water parameters
SEA_LEVEL = 0.8  # height above the planet radius where water begins
WATER_COLOR = np.array([0.02, 0.12, 0.28], dtype=np.float32)
WATER_ABSORPTION = 2.0
WATER_SCATTERING = 0.4

# Raymarch distances scale with the planet to ensure intersections are found
# reliably without overshooting.
MAX_RAY_DISTANCE = PLANET_RADIUS * 8.0
