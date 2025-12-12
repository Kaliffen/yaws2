from OpenGL.GL import *
import numpy as np


def set_vec3(program, name, v):
    loc = glGetUniformLocation(program, name)
    glUniform3f(loc, float(v[0]), float(v[1]), float(v[2]))


def set_vec2(program, name, v):
    loc = glGetUniformLocation(program, name)
    glUniform2f(loc, float(v[0]), float(v[1]))


def set_float(program, name, value):
    loc = glGetUniformLocation(program, name)
    glUniform1f(loc, float(value))


def set_int(program, name, value):
    loc = glGetUniformLocation(program, name)
    glUniform1i(loc, int(value))


def set_mat4(program, name, m):
    loc = glGetUniformLocation(program, name)
    glUniformMatrix4fv(loc, 1, GL_FALSE, m.astype("float32"))


def set_mat3(program, name, m):
    loc = glGetUniformLocation(program, name)
    glUniformMatrix3fv(
        loc,
        1,
        GL_FALSE,
        np.array(m, dtype=np.float32).flatten(order="F"),
    )
