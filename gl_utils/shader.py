from OpenGL.GL import *


def compile_shader(src, shader_type):
    shader = glCreateShader(shader_type)
    glShaderSource(shader, src)
    glCompileShader(shader)

    success = glGetShaderiv(shader, GL_COMPILE_STATUS)
    if not success:
        log = glGetShaderInfoLog(shader).decode()
        raise RuntimeError(f"Shader compilation failed:\n{log}")

    return shader
