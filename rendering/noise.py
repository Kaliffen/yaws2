import numpy as np
from OpenGL.GL import *


def generate_value_noise_3d(size: int, seed: int = 1337) -> np.ndarray:
    """Generate a tiled 3D value noise volume.

    The generated volume wraps seamlessly so it can be sampled with GL_REPEAT.
    """

    rng = np.random.default_rng(seed)
    return rng.random((size, size, size), dtype=np.float32)


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
