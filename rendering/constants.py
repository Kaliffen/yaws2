import numpy as np

SUN_DIRECTION = np.array([0.6, 0.4, 0.7], dtype=np.float32)

# Base scale values for the planet and atmosphere
# A significantly larger planet keeps curvature realistic from orbit while
# keeping the atmosphere a thin shell.
PLANET_RADIUS = 120.0
ATMOSPHERE_RADIUS = PLANET_RADIUS * 1.03

# Terrain displacement remains small relative to the radius to avoid
# exaggerated features when scaling up the planet size.
HEIGHT_SCALE = PLANET_RADIUS * 0.017

# Raymarch distances scale with the planet to ensure intersections are found
# reliably without overshooting.
MAX_RAY_DISTANCE = PLANET_RADIUS * 8.0
