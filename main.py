import glfw
from OpenGL.GL import *
import imgui
from imgui.integrations.glfw import GlfwRenderer
import numpy as np

from gl_utils.program import create_program
from gl_utils.buffers import create_fullscreen_quad
from gl_utils.camera import FPSCamera
from rendering.constants import PlanetParameters, default_planet_parameters
from rendering.planet_renderer import PlanetRenderer
from utils.time import DeltaTimer


def compute_adaptive_speed(position, base_speed, planet_radius):
    distance = np.linalg.norm(position)
    distance_ratio = distance / planet_radius
    adaptive_factor = np.clip(0.15 + distance_ratio * 0.85, 0.15, 4.0)
    return base_speed * adaptive_factor


def clamp_to_radius(camera, min_radius):
    distance = np.linalg.norm(camera.position)
    if distance < min_radius and distance > 0.0:
        camera.position = (camera.position / distance) * min_radius


def draw_parameter_panel(editing_params: PlanetParameters):
    imgui.begin("Planet Parameters")

    time_changed, editing_params.time_of_day_hours = imgui.slider_float(
        "Time of day (hours)", editing_params.time_of_day_hours, 0.0, 24.0
    )
    year_changed, editing_params.time_of_year = imgui.slider_float(
        "Time of year (0-1)", editing_params.time_of_year, 0.0, 1.0
    )
    tilt_changed, editing_params.axial_tilt_degrees = imgui.slider_float(
        "Axial tilt (deg)", editing_params.axial_tilt_degrees, 0.0, 45.0
    )
    _, editing_params.rotation_speed_hours_per_sec = imgui.slider_float(
        "Rotation speed (hours/sec)",
        editing_params.rotation_speed_hours_per_sec,
        0.0,
        2.0,
    )
    if time_changed or year_changed or tilt_changed:
        editing_params.update_sun_direction()
    imgui.text(
        "Sun direction: {:.2f}, {:.2f}, {:.2f}".format(
            editing_params.sun_direction[0],
            editing_params.sun_direction[1],
            editing_params.sun_direction[2],
        )
    )

    planet_changed, editing_params.planet_radius = imgui.input_float(
        "Planet radius (km)", editing_params.planet_radius, step=10.0, step_fast=50.0
    )
    if planet_changed:
        editing_params.scale_with_planet_radius()
    atmos_changed, editing_params.atmosphere_thickness_percent = imgui.slider_float(
        "Atmosphere thickness (%)", editing_params.atmosphere_thickness_percent, 0.5, 20.0
    )
    cloud_base_changed, editing_params.cloud_base_percent = imgui.slider_float(
        "Cloud base (% of atmosphere)", editing_params.cloud_base_percent, 0.0, 100.0
    )
    cloud_thickness_changed, editing_params.cloud_layer_thickness_percent = imgui.slider_float(
        "Cloud thickness (% of atmosphere)", editing_params.cloud_layer_thickness_percent, 0.0, 100.0
    )
    if atmos_changed or cloud_base_changed or cloud_thickness_changed:
        editing_params.scale_with_planet_radius()
    imgui.text(f"Atmosphere radius: {editing_params.atmosphere_radius:.2f} km")
    imgui.text(f"Cloud base altitude: {editing_params.cloud_base_altitude:.2f} km")
    imgui.text(f"Cloud thickness: {editing_params.cloud_layer_thickness:.2f} km")
    _, editing_params.height_scale = imgui.input_float(
        "Height scale (km)", editing_params.height_scale, step=10.0, step_fast=50.0
    )
    _, editing_params.sea_level = imgui.input_float(
        "Sea level offset (km)", editing_params.sea_level, step=1.0, step_fast=5.0
    )

    changed, water_color = imgui.input_float3("Water color", *editing_params.water_color)
    if changed:
        editing_params.water_color = np.array(water_color, dtype=np.float32)
    _, editing_params.water_absorption = imgui.input_float(
        "Water absorption", editing_params.water_absorption, step=0.01, step_fast=0.05
    )
    _, editing_params.water_scattering = imgui.input_float(
        "Water scattering", editing_params.water_scattering, step=0.01, step_fast=0.05
    )

    _, editing_params.max_ray_distance = imgui.input_float(
        "Max ray distance", editing_params.max_ray_distance, step=50.0, step_fast=200.0
    )
    _, editing_params.cloud_coverage = imgui.slider_float(
        "Cloud coverage", editing_params.cloud_coverage, 0.0, 1.0
    )
    _, editing_params.cloud_density = imgui.slider_float(
        "Cloud density", editing_params.cloud_density, 0.0, 1.0
    )
    changed, cloud_light = imgui.input_float3("Cloud light color", *editing_params.cloud_light_color)
    if changed:
        editing_params.cloud_light_color = np.array(cloud_light, dtype=np.float32)

    update_clicked = False
    reset_clicked = False

    if imgui.button("Update", width=100):
        update_clicked = True
    imgui.same_line()
    if imgui.button("Reset", width=100):
        reset_clicked = True

    imgui.end()
    return update_clicked, reset_clicked


def draw_raymarch_panels(editing_params: PlanetParameters):
    imgui.begin("Planet Raymarch")

    _, editing_params.planet_max_steps = imgui.input_int(
        "Max steps", editing_params.planet_max_steps, step=1, step_fast=10
    )
    editing_params.planet_max_steps = max(editing_params.planet_max_steps, 1)

    _, editing_params.planet_step_scale = imgui.input_float(
        "Step scale", editing_params.planet_step_scale, step=0.01, step_fast=0.05
    )
    _, editing_params.planet_min_step_factor = imgui.input_float(
        "Min step factor", editing_params.planet_min_step_factor, step=0.01, step_fast=0.05
    )

    imgui.end()

    imgui.begin("Cloud Raymarch")

    _, editing_params.cloud_max_steps = imgui.input_int(
        "Max steps", editing_params.cloud_max_steps, step=1, step_fast=10
    )
    editing_params.cloud_max_steps = max(editing_params.cloud_max_steps, 1)

    _, editing_params.cloud_extinction = imgui.input_float(
        "Extinction factor", editing_params.cloud_extinction, step=0.01, step_fast=0.1
    )
    _, editing_params.cloud_phase_exponent = imgui.input_float(
        "Phase exponent", editing_params.cloud_phase_exponent, step=0.1, step_fast=0.5
    )

    imgui.end()


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
    with open("shaders/gbuffer.frag") as f:
        gbuffer_src = f.read()
    with open("shaders/lighting.frag") as f:
        lighting_src = f.read()
    with open("shaders/atmosphere.frag") as f:
        atmosphere_src = f.read()
    with open("shaders/clouds.frag") as f:
        cloud_src = f.read()
    with open("shaders/composite.frag") as f:
        composite_src = f.read()

    gbuffer_program = create_program(vert_src, gbuffer_src)
    lighting_program = create_program(vert_src, lighting_src)
    atmosphere_program = create_program(vert_src, atmosphere_src)
    cloud_program = create_program(vert_src, cloud_src)
    composite_program = create_program(vert_src, composite_src)

    glUseProgram(gbuffer_program)

    parameters = default_planet_parameters()
    editing_params = parameters.copy()

    camera = FPSCamera(
        position=np.array([0.0, 0.0, parameters.planet_radius * 1.6], dtype=np.float32),
        yaw=-90.0,
        pitch=0.0
    )
    # Start with a modest base speed so surface traversal feels grounded. Speed
    # ramps up automatically as you get farther from the planet.
    base_speed = 60.0
    camera.speed = base_speed
    surface_radius = parameters.planet_radius + parameters.height_scale
    camera.min_radius = surface_radius - parameters.height_scale * 0.95

    renderer = PlanetRenderer(
        gbuffer_program,
        lighting_program,
        atmosphere_program,
        cloud_program,
        composite_program,
        parameters,
    )
    timer = DeltaTimer()

    layer_visibility = [False] * 9
    pressed_state = [False] * 9

    camera_mode = True
    space_pressed = False

    last_mouse_x, last_mouse_y = width / 2, height / 2
    first_mouse = True

    glfw.set_input_mode(window, glfw.CURSOR, glfw.CURSOR_DISABLED)

    imgui.create_context()
    imgui_renderer = GlfwRenderer(window)

    while not glfw.window_should_close(window):
        dt = timer.get_delta()
        glfw.poll_events()
        imgui_renderer.process_inputs()
        imgui.new_frame()

        if parameters.rotation_speed_hours_per_sec != 0.0:
            hours_advanced = parameters.rotation_speed_hours_per_sec * dt
            parameters.time_of_day_hours = (parameters.time_of_day_hours + hours_advanced) % 24.0
            parameters.update_sun_direction()
            editing_params.time_of_day_hours = parameters.time_of_day_hours
            editing_params.sun_direction = np.array(parameters.sun_direction, dtype=np.float32)

        io = imgui.get_io()

        if glfw.get_key(window, glfw.KEY_ESCAPE) == glfw.PRESS:
            glfw.set_window_should_close(window, True)

        # Toggle between camera and cursor interaction modes
        space_down = glfw.get_key(window, glfw.KEY_SPACE) == glfw.PRESS
        if space_down and not space_pressed:
            camera_mode = not camera_mode
            glfw.set_input_mode(
                window,
                glfw.CURSOR,
                glfw.CURSOR_DISABLED if camera_mode else glfw.CURSOR_NORMAL,
            )
            first_mouse = True
        space_pressed = space_down

        # Mouse look when in camera mode
        mx, my = glfw.get_cursor_pos(window)
        if first_mouse:
            last_mouse_x, last_mouse_y = mx, my
            first_mouse = False

        xoff = mx - last_mouse_x
        yoff = last_mouse_y - my
        last_mouse_x, last_mouse_y = mx, my

        if camera_mode and not io.want_capture_mouse:
            camera.process_mouse(xoff, yoff)

        # Keyboard
        shift_pressed = glfw.get_key(window, glfw.KEY_LEFT_SHIFT) == glfw.PRESS
        speed_multiplier = 10.0 if shift_pressed else 1.0
        camera.speed = compute_adaptive_speed(camera.position, base_speed, parameters.planet_radius) * speed_multiplier

        if not io.want_capture_keyboard:
            if glfw.get_key(window, glfw.KEY_W) == glfw.PRESS:
                camera.process_movement("FORWARD", dt)
            if glfw.get_key(window, glfw.KEY_S) == glfw.PRESS:
                camera.process_movement("BACKWARD", dt)
            if glfw.get_key(window, glfw.KEY_A) == glfw.PRESS:
                camera.process_movement("LEFT", dt)
            if glfw.get_key(window, glfw.KEY_D) == glfw.PRESS:
                camera.process_movement("RIGHT", dt)

            for idx, key in enumerate([
                glfw.KEY_1,
                glfw.KEY_2,
                glfw.KEY_3,
                glfw.KEY_4,
                glfw.KEY_5,
                glfw.KEY_6,
                glfw.KEY_7,
                glfw.KEY_8,
                glfw.KEY_9,
            ]):
                is_pressed = glfw.get_key(window, key) == glfw.PRESS
                if is_pressed and not pressed_state[idx]:
                    layer_visibility[idx] = not layer_visibility[idx]
                pressed_state[idx] = is_pressed

        framebuffer_width, framebuffer_height = glfw.get_framebuffer_size(window)
        width, height = framebuffer_width or width, framebuffer_height or height

        update_clicked, reset_clicked = draw_parameter_panel(editing_params)
        draw_raymarch_panels(editing_params)

        if update_clicked:
            parameters = editing_params.copy()
            renderer.update_parameters(parameters)
            surface_radius = parameters.planet_radius + parameters.height_scale
            camera.min_radius = surface_radius - parameters.height_scale * 0.95
            clamp_to_radius(camera, camera.min_radius)
            editing_params = parameters.copy()
        elif reset_clicked:
            editing_params = parameters.copy()

        glViewport(0, 0, width, height)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glBindVertexArray(quad_vao)
        renderer.render(
            camera.position,
            camera.front,
            camera.right,
            camera.up,
            width,
            height,
            layer_visibility
        )

        imgui.render()
        imgui_renderer.render(imgui.get_draw_data())

        glfw.swap_buffers(window)

    glfw.terminate()


if __name__ == "__main__":
    main()
