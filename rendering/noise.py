import numpy as np
from OpenGL.GL import *


def _fade(t: np.ndarray) -> np.ndarray:
    """Smoothstep-like fade curve used for gradient interpolation."""

    return t * t * t * (t * (t * 6 - 15) + 10)


def _lerp(a: np.ndarray, b: np.ndarray, t: np.ndarray) -> np.ndarray:
    return a + t * (b - a)


def _generate_gradients(period: int, rng: np.random.Generator) -> np.ndarray:
    grads = rng.standard_normal((period, period, period, 3)).astype(np.float32)
    norms = np.linalg.norm(grads, axis=3, keepdims=True)
    norms = np.maximum(norms, 1e-6)
    return grads / norms


def _perlin_octave(size: int, period: int, rng: np.random.Generator) -> np.ndarray:
    """Generate a single seamless Perlin octave with the given lattice period."""

    gradients = _generate_gradients(period, rng)

    coords = np.linspace(0, period, size, endpoint=False, dtype=np.float32)
    x, y, z = np.meshgrid(coords, coords, coords, indexing="ij")

    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    zi = np.floor(z).astype(np.int32)

    xf = x - xi
    yf = y - yi
    zf = z - zi

    xi0 = xi % period
    yi0 = yi % period
    zi0 = zi % period

    xi1 = (xi0 + 1) % period
    yi1 = (yi0 + 1) % period
    zi1 = (zi0 + 1) % period

    def dot_grad(ix, iy, iz, dx, dy, dz):
        g = gradients[ix, iy, iz]
        return g[..., 0] * dx + g[..., 1] * dy + g[..., 2] * dz

    n000 = dot_grad(xi0, yi0, zi0, xf, yf, zf)
    n100 = dot_grad(xi1, yi0, zi0, xf - 1, yf, zf)
    n010 = dot_grad(xi0, yi1, zi0, xf, yf - 1, zf)
    n110 = dot_grad(xi1, yi1, zi0, xf - 1, yf - 1, zf)
    n001 = dot_grad(xi0, yi0, zi1, xf, yf, zf - 1)
    n101 = dot_grad(xi1, yi0, zi1, xf - 1, yf, zf - 1)
    n011 = dot_grad(xi0, yi1, zi1, xf, yf - 1, zf - 1)
    n111 = dot_grad(xi1, yi1, zi1, xf - 1, yf - 1, zf - 1)

    u = _fade(xf)
    v = _fade(yf)
    w = _fade(zf)

    x00 = _lerp(n000, n100, u)
    x10 = _lerp(n010, n110, u)
    x01 = _lerp(n001, n101, u)
    x11 = _lerp(n011, n111, u)

    y0 = _lerp(x00, x10, v)
    y1 = _lerp(x01, x11, v)

    return _lerp(y0, y1, w)


def generate_value_noise_3d(size: int, seed: int = 1337) -> np.ndarray:
    """Generate a tiled 3D fractal gradient noise volume for continent shaping.

    The resulting noise is smooth, seamlessly tiles with GL_REPEAT, and contains
    multiple blended octaves to emphasize broad continents with subtle detail.
    """

    rng = np.random.default_rng(seed)

    octaves = [
        (8, 0.55),   # continent-sized shapes
        (14, 0.32),  # midsize ridges
        (24, 0.18),  # shoreline variation
        (48, 0.12),  # subtle micro detail for plains
    ]

    volume = np.zeros((size, size, size), dtype=np.float32)
    amplitude_accum = 0.0
    for period, amp in octaves:
        octave = _perlin_octave(size, period, rng)
        volume += amp * octave
        amplitude_accum += amp

    # Normalize to 0..1 and apply a gentle contrast curve to favor smooth plains
    volume /= max(amplitude_accum, 1e-6)
    volume = (volume + 1.0) * 0.5  # map from [-1,1] to [0,1]
    volume = np.clip(volume, 0.0, 1.0)
    volume = volume ** 1.2

    return volume


def upload_value_noise_volume(noise_volume: np.ndarray) -> int:
    """Upload a 3D noise texture and return its handle."""

    if noise_volume.ndim != 3:
        raise ValueError("Noise volume must be 3D")

    size = noise_volume.shape[0]
    if not (noise_volume.shape[1] == size and noise_volume.shape[2] == size):
        raise ValueError("Noise volume must be cubic")

    data = np.ascontiguousarray(noise_volume)

    texture = glGenTextures(1)
    glBindTexture(GL_TEXTURE_3D, texture)
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_REPEAT)
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_REPEAT)
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_REPEAT)

    glTexImage3D(
        GL_TEXTURE_3D,
        0,
        GL_R32F,
        size,
        size,
        size,
        0,
        GL_RED,
        GL_FLOAT,
        data,
    )

    glBindTexture(GL_TEXTURE_3D, 0)
    return texture
