import glfw
from OpenGL.GL import *
import numpy as np
import time

from gl_utils.shader import compile_shader
from gl_utils.program import create_program
from gl_utils.buffers import create_fullscreen_quad
from gl_utils.camera import FPSCamera
from rendering.constants import HEIGHT_SCALE, PLANET_RADIUS
from rendering.planet_renderer import PlanetRenderer
from utils.time import DeltaTimer


def compute_adaptive_speed(position, base_speed):
    distance = np.linalg.norm(position)
    distance_ratio = distance / PLANET_RADIUS
    adaptive_factor = np.clip(0.15 + distance_ratio * 0.85, 0.15, 4.0)
    return base_speed * adaptive_factor


def main():
    if not glfw.init():
        raise RuntimeError("Failed to initialize GLFW")

    glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 4)
    glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 1)
    glfw.window_hint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE)
    glfw.window_hint(glfw.OPENGL_FORWARD_COMPAT, GL_TRUE)

    width, height = 1280, 720
    window = glfw.create_window(width, height, "SDF Planet Demo", None, None)
    if not window:
        glfw.terminate()
        raise RuntimeError("Failed to create window")

    glfw.make_context_current(window)

    quad_vao = create_fullscreen_quad()

    with open("shaders/planet.vert") as f:
        vert_src = f.read()
    with open("shaders/planet.frag") as f:
        frag_src = f.read()

    program = create_program(vert_src, frag_src)

    glUseProgram(program)

    camera = FPSCamera(
        position=np.array([0.0, 0.0, PLANET_RADIUS * 1.6], dtype=np.float32),
        yaw=-90.0,
        pitch=0.0
    )
    base_speed = PLANET_RADIUS * 0.35
    camera.speed = base_speed
    surface_radius = PLANET_RADIUS + HEIGHT_SCALE
    camera.min_radius = surface_radius + HEIGHT_SCALE * 0.25

    renderer = PlanetRenderer(program)
    timer = DeltaTimer()

    last_mouse_x, last_mouse_y = width / 2, height / 2
    first_mouse = True

    glfw.set_input_mode(window, glfw.CURSOR, glfw.CURSOR_DISABLED)

    while not glfw.window_should_close(window):
        dt = timer.get_delta()

        if glfw.get_key(window, glfw.KEY_ESCAPE) == glfw.PRESS:
            glfw.set_window_should_close(window, True)

        # Mouse look
        mx, my = glfw.get_cursor_pos(window)
        if first_mouse:
            last_mouse_x, last_mouse_y = mx, my
            first_mouse = False

        xoff = mx - last_mouse_x
        yoff = last_mouse_y - my
        last_mouse_x, last_mouse_y = mx, my

        camera.process_mouse(xoff, yoff)

        # Keyboard
        shift_pressed = glfw.get_key(window, glfw.KEY_LEFT_SHIFT) == glfw.PRESS
        speed_multiplier = 10.0 if shift_pressed else 1.0
        camera.speed = compute_adaptive_speed(camera.position, base_speed) * speed_multiplier

        if glfw.get_key(window, glfw.KEY_W) == glfw.PRESS:
            camera.process_movement("FORWARD", dt)
        if glfw.get_key(window, glfw.KEY_S) == glfw.PRESS:
            camera.process_movement("BACKWARD", dt)
        if glfw.get_key(window, glfw.KEY_A) == glfw.PRESS:
            camera.process_movement("LEFT", dt)
        if glfw.get_key(window, glfw.KEY_D) == glfw.PRESS:
            camera.process_movement("RIGHT", dt)

        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        renderer.render(
            camera.position,
            camera.front,
            camera.right,
            camera.up,
            width,
            height,
            dt,
            time.time()
        )

        glBindVertexArray(quad_vao)
        glDrawArrays(GL_TRIANGLES, 0, 6)

        glfw.swap_buffers(window)
        glfw.poll_events()

    glfw.terminate()


if __name__ == "__main__":
    main()
