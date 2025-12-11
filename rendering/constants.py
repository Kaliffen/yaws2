import numpy as np

SUN_DIRECTION = np.array([0.62, 0.32, 0.71], dtype=np.float32)

# Base scale values for the planet and atmosphere (kilometers)
# Use a realistic Earth-sized radius so the horizon and curvature feel correct
# when flying close to the surface.
PLANET_RADIUS = 6371.0

# Keep a thin atmospheric shell around the surface (~120 km thick).
ATMOSPHERE_RADIUS = PLANET_RADIUS + 120.0

# Keep terrain displacement realistic relative to the planet scale to avoid
# exaggerated features.
HEIGHT_SCALE = 325.2

# Water parameters
SEA_LEVEL = 0.999900  # height above the planet radius where water begins
# Slightly brighter water with a touch more scattering makes oceans stand out
# against land.
WATER_COLOR = np.array([0.02, 0.16, 0.34], dtype=np.float32)
WATER_ABSORPTION = 0.24
WATER_SCATTERING = 0.12

# Raymarch distances scale with the planet to ensure intersections are found
# reliably without overshooting.
MAX_RAY_DISTANCE = PLANET_RADIUS * 2.0
