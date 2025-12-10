from OpenGL.GL import *
import numpy as np


def create_fullscreen_quad():
    vertices = np.array([
        -1.0, -1.0,
        1.0, -1.0,
        1.0,  1.0,

        -1.0, -1.0,
        1.0,  1.0,
        -1.0,  1.0
    ], dtype=np.float32)

    vao = glGenVertexArrays(1)
    vbo = glGenBuffers(1)

    glBindVertexArray(vao)
    glBindBuffer(GL_ARRAY_BUFFER, vbo)
    glBufferData(GL_ARRAY_BUFFER, vertices.nbytes, vertices, GL_STATIC_DRAW)

    glEnableVertexAttribArray(0)
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * 4, None)

    glBindBuffer(GL_ARRAY_BUFFER, 0)
    glBindVertexArray(0)

    return vao
