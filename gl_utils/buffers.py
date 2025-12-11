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


def create_texture(width, height, attachment, internal_format=GL_RGBA16F, format=GL_RGBA, type=GL_FLOAT):
    tex = glGenTextures(1)
    glBindTexture(GL_TEXTURE_2D, tex)
    glTexImage2D(GL_TEXTURE_2D, 0, internal_format, width, height, 0, format, type, None)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
    glFramebufferTexture2D(GL_FRAMEBUFFER, attachment, GL_TEXTURE_2D, tex, 0)
    return tex


def create_gbuffer(width, height):
    fbo = glGenFramebuffers(1)
    glBindFramebuffer(GL_FRAMEBUFFER, fbo)

    gPositionHeight = create_texture(width, height, GL_COLOR_ATTACHMENT0)
    gNormalFlags = create_texture(width, height, GL_COLOR_ATTACHMENT1)
    gMaterial = create_texture(width, height, GL_COLOR_ATTACHMENT2)

    rbo = glGenRenderbuffers(1)
    glBindRenderbuffer(GL_RENDERBUFFER, rbo)
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height)
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, rbo)

    attachments = [GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1, GL_COLOR_ATTACHMENT2]
    glDrawBuffers(len(attachments), attachments)

    if glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE:
        raise RuntimeError("G-buffer framebuffer is not complete")

    glBindFramebuffer(GL_FRAMEBUFFER, 0)
    return {
        "fbo": fbo,
        "position": gPositionHeight,
        "normal": gNormalFlags,
        "material": gMaterial,
        "rbo": rbo,
        "width": width,
        "height": height,
    }


def create_color_fbo(width, height, num_attachments=1, internal_format=GL_RGBA16F):
    fbo = glGenFramebuffers(1)
    glBindFramebuffer(GL_FRAMEBUFFER, fbo)

    attachments = []
    textures = []
    for i in range(num_attachments):
        attachment = GL_COLOR_ATTACHMENT0 + i
        attachments.append(attachment)
        textures.append(create_texture(width, height, attachment, internal_format))

    glDrawBuffers(len(attachments), attachments)

    if glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE:
        raise RuntimeError("Color framebuffer is not complete")

    glBindFramebuffer(GL_FRAMEBUFFER, 0)
    return {
        "fbo": fbo,
        "textures": textures,
        "width": width,
        "height": height,
    }
