from OpenGL.GL import *
from .shader import compile_shader


def create_program(vert_src, frag_src):
    vs = compile_shader(vert_src, GL_VERTEX_SHADER)
    fs = compile_shader(frag_src, GL_FRAGMENT_SHADER)

    program = glCreateProgram()
    glAttachShader(program, vs)
    glAttachShader(program, fs)
    glLinkProgram(program)

    success = glGetProgramiv(program, GL_LINK_STATUS)
    if not success:
        log = glGetProgramInfoLog(program).decode()
        raise RuntimeError(f"Program link failed:\n{log}")

    glDeleteShader(vs)
    glDeleteShader(fs)
    return program
