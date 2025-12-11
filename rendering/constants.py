import numpy as np

SUN_DIRECTION = np.array([0.62, 0.32, 0.71], dtype=np.float32)

# Base scale values for the planet and atmosphere (kilometers)
# Use a realistic Earth-sized radius so the horizon and curvature feel correct
# when flying close to the surface.
PLANET_RADIUS = 6371.0

# Keep a thin atmospheric shell around the surface (~110 km thick).
ATMOSPHERE_RADIUS = PLANET_RADIUS + 210.0

# Keep terrain displacement realistic relative to the planet scale to avoid
# exaggerated features, but still allow visible mountain ranges.
HEIGHT_SCALE = 532.2

# Water parameters
# Interpret sea level as a world-space height offset instead of a fractional
# multiplier so the shader math stays consistent. A small positive offset keeps
# shallow coastlines without burying continents.
SEA_LEVEL = -35.0  # kilometers above the planet radius
# Slightly brighter water with a touch more scattering makes oceans stand out
# against land.
WATER_COLOR = np.array([0.02, 0.16, 0.34], dtype=np.float32)
WATER_ABSORPTION = 0.24
WATER_SCATTERING = 0.14

# Raymarch distances scale with the planet to ensure intersections are found
# reliably without overshooting. A longer distance avoids missing the planet
# when pulling far back for full-globe views.
MAX_RAY_DISTANCE = PLANET_RADIUS * 3.0
