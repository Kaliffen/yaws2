import numpy as np


def _hash(p: np.ndarray) -> np.ndarray:
    p = np.modf(p * 0.3183099 + 0.1)[0]
    p *= 17.0
    return np.modf(p[..., 0] * p[..., 1] * p[..., 2] * (p[..., 0] + p[..., 1] + p[..., 2]))[0]


def _noise(p: np.ndarray) -> np.ndarray:
    i = np.floor(p)
    f = p - i

    offsets = np.array(
        [
            [0, 0, 0],
            [0, 0, 1],
            [0, 1, 0],
            [0, 1, 1],
            [1, 0, 0],
            [1, 0, 1],
            [1, 1, 0],
            [1, 1, 1],
        ],
        dtype=np.float32,
    )

    corner_hashes = np.stack([_hash(i + off) for off in offsets], axis=-1)
    u = f * f * (3.0 - 2.0 * f)

    lerp_x0 = corner_hashes[..., 0] * (1.0 - u[..., 0]) + corner_hashes[..., 4] * u[..., 0]
    lerp_x1 = corner_hashes[..., 2] * (1.0 - u[..., 0]) + corner_hashes[..., 6] * u[..., 0]
    lerp_y0 = lerp_x0 * (1.0 - u[..., 1]) + lerp_x1 * u[..., 1]

    lerp_x2 = corner_hashes[..., 1] * (1.0 - u[..., 0]) + corner_hashes[..., 5] * u[..., 0]
    lerp_x3 = corner_hashes[..., 3] * (1.0 - u[..., 0]) + corner_hashes[..., 7] * u[..., 0]
    lerp_y1 = lerp_x2 * (1.0 - u[..., 1]) + lerp_x3 * u[..., 1]

    return lerp_y0 * (1.0 - u[..., 2]) + lerp_y1 * u[..., 2]


def _fbm(p: np.ndarray, octaves: int = 5) -> np.ndarray:
    v = np.zeros(p.shape[:-1], dtype=np.float32)
    a = 0.5
    coords = p.copy()
    for _ in range(octaves):
        v += a * _noise(coords)
        coords *= 2.0
        a *= 0.5
    return v


def terrain_height(point: np.ndarray, planet_radius: float, height_scale: float) -> float:
    scaled_p = point / planet_radius

    warp_freq = 1.15
    warp_amp = 0.06

    warp = np.stack(
        [
            _fbm(scaled_p * warp_freq + np.array([11.7, 0.0, 0.0], dtype=np.float32)),
            _fbm(scaled_p * warp_freq + np.array([3.9, 17.2, 5.1], dtype=np.float32)),
            _fbm(scaled_p * warp_freq - np.array([7.5, 0.0, 0.0], dtype=np.float32)),
        ],
        axis=-1,
    )

    warped_p = scaled_p * 8.0 + (warp - 0.5) * 2.0 * warp_amp

    base = _fbm(warped_p)
    detail = _fbm(warped_p * 2.5) * 0.35

    normalized = base * 0.62 + detail * 0.38
    return float((normalized - 0.42) * height_scale)


def planet_sdf(point: np.ndarray, planet_radius: float, height_scale: float) -> float:
    r = np.linalg.norm(point)
    h = terrain_height(point, planet_radius, height_scale)
    return float(r - (planet_radius + h))


def generate_noise_volume(resolution: int = 128, value_range: float = 64.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    coords = np.linspace(-value_range, value_range, resolution, dtype=np.float32)
    grid = np.stack(np.meshgrid(coords, coords, coords, indexing="ij"), axis=-1)
    volume = _noise(grid).astype(np.float32)
    min_corner = np.array([-value_range] * 3, dtype=np.float32)
    max_corner = np.array([value_range] * 3, dtype=np.float32)
    return volume, min_corner, max_corner


def generate_sdf_volume(
    planet_radius: float,
    height_scale: float,
    max_distance: float,
    resolution: int = 128,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    coords = np.linspace(-max_distance, max_distance, resolution, dtype=np.float32)
    volume = np.zeros((resolution, resolution, resolution), dtype=np.float32)

    for ix, x in enumerate(coords):
        for iy, y in enumerate(coords):
            for iz, z in enumerate(coords):
                p = np.array([x, y, z], dtype=np.float32)
                volume[ix, iy, iz] = planet_sdf(p, planet_radius, height_scale)

    min_corner = np.array([-max_distance] * 3, dtype=np.float32)
    max_corner = np.array([max_distance] * 3, dtype=np.float32)
    return volume, min_corner, max_corner
