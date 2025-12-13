import glfw
from OpenGL.GL import *
import imgui
from imgui.integrations.glfw import GlfwRenderer
import numpy as np

from gl_utils.program import create_compute_program, create_program
from gl_utils.buffers import create_fullscreen_quad
from gl_utils.camera import FPSCamera, normalize, WORLD_UP
from rendering.constants import PlanetParameters, default_planet_parameters, SCALAR
from rendering.planet_renderer import PlanetRenderer
from utils.time import DeltaTimer, PlanetCalendar


def compute_adaptive_speed(position, base_speed, planet_radius):
    distance = np.linalg.norm(position)
    distance_ratio = distance / planet_radius
    adaptive_factor = np.clip(0.15 + distance_ratio * 0.85, 0.15, 4.0)
    return base_speed * adaptive_factor




def project_to_plane(vector, normal):
    return vector - normal * np.dot(vector, normal)


def apply_raymarch_preset(editing_params: PlanetParameters, preset: str):
    presets = {
        "Low": {
            "planet_max_steps": 124,
            "planet_step_scale": 0.2,
            "planet_min_step_factor": 0.2,
            "cloud_max_steps": 28,
            "cloud_extinction": 0.65,
            "cloud_phase_exponent": 2.1,
            "max_ray_distance_factor": 2,
        },
        "Medium": {
            "planet_max_steps": 128,
            "planet_step_scale": 0.2,
            "planet_min_step_factor": 0.1,
            "cloud_max_steps": 48,
            "cloud_extinction": 0.55,
            "cloud_phase_exponent": 2.5,
            "max_ray_distance_factor": 3.0,
        },
        "High": {
            "planet_max_steps": 256,
            "planet_step_scale": 0.1,
            "planet_min_step_factor": 0.1,
            "cloud_max_steps": 48,
            "cloud_extinction": 0.45,
            "cloud_phase_exponent": 3.0,
            "max_ray_distance_factor": 3,
        },
    }

    config = presets.get(preset)
    if not config:
        return

    editing_params.planet_max_steps = config["planet_max_steps"]
    editing_params.planet_step_scale = config["planet_step_scale"]
    editing_params.planet_min_step_factor = config["planet_min_step_factor"]
    editing_params.cloud_max_steps = config["cloud_max_steps"]
    editing_params.cloud_extinction = config["cloud_extinction"]
    editing_params.cloud_phase_exponent = config["cloud_phase_exponent"]
    editing_params.max_ray_distance = editing_params.planet_radius * config["max_ray_distance_factor"]


def draw_parameter_panel(editing_params: PlanetParameters):
    io = imgui.get_io()
    right_panel_width = max(io.display_size.x * 0.28, 360.0)
    imgui.set_next_window_position(
        io.display_size.x - right_panel_width - 12.0, 12.0, condition=imgui.FIRST_USE_EVER
    )
    imgui.set_next_window_size(right_panel_width, 0.0, condition=imgui.FIRST_USE_EVER)
    imgui.begin("Planet Parameters")

    changed, sun_dir = imgui.slider_float3("Sun direction", *editing_params.sun_direction, -1.0, 1.0)
    if changed:
        new_direction = np.array(sun_dir, dtype=np.float32)
        length = np.linalg.norm(new_direction)
        if length > 1e-5:
            new_direction = new_direction / length
        editing_params.sun_direction = new_direction

    _, editing_params.sun_power = imgui.slider_float("Sun power", editing_params.sun_power, 0.0, 25.0)

    _, editing_params.tilt_degrees = imgui.slider_float("Tilt (deg)", editing_params.tilt_degrees, 0.0, 45.0)

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

    _, editing_params.cloud_coverage = imgui.slider_float(
        "Cloud coverage", editing_params.cloud_coverage, 0.0, 1.0
    )
    _, editing_params.cloud_density = imgui.slider_float(
        "Cloud density", editing_params.cloud_density, 0.0, 1.0
    )
    _, editing_params.cloud_animation_speed = imgui.slider_float(
        "Cloud animation speed", editing_params.cloud_animation_speed, 0.0, 0.2
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


def draw_performance_panel(
    editing_params: PlanetParameters,
    calendar_state,
    days_in_year: int,
    gravity_enabled: bool,
    player_height: float,
    min_ground_clearance: float,
):
    io = imgui.get_io()
    left_panel_width = max(io.display_size.x * 0.28, 340.0)
    imgui.set_next_window_position(12.0, 12.0, condition=imgui.FIRST_USE_EVER)
    imgui.set_next_window_size(left_panel_width, 0.0, condition=imgui.FIRST_USE_EVER)
    imgui.begin("Performance & Raymarching")

    imgui.text("Quality presets")
    if imgui.button("Low", width=90):
        apply_raymarch_preset(editing_params, "Low")
    imgui.same_line()
    if imgui.button("Medium", width=90):
        apply_raymarch_preset(editing_params, "Medium")
    imgui.same_line()
    if imgui.button("High", width=90):
        apply_raymarch_preset(editing_params, "High")

    imgui.separator()

    imgui.text("Calendar")
    imgui.text(f"Day {calendar_state.day_index + 1} / {days_in_year}")
    imgui.text(
        f"Time {calendar_state.hour:02d}:{calendar_state.minute:02d}:{calendar_state.second:02d}"
    )
    _, editing_params.time_speed = imgui.input_float(
        "Time speed (x realtime)", editing_params.time_speed, step=0.5, step_fast=5.0
    )
    editing_params.time_speed = max(editing_params.time_speed, 0.0)
    imgui.separator()

    imgui.text("Ray distances")
    _, editing_params.max_ray_distance = imgui.input_float(
        "Max ray distance", editing_params.max_ray_distance, step=50.0, step_fast=200.0
    )

    imgui.separator()
    imgui.text("Planet raymarch")
    _, editing_params.planet_max_steps = imgui.input_int(
        "Max p steps", editing_params.planet_max_steps, step=1, step_fast=10
    )
    editing_params.planet_max_steps = max(editing_params.planet_max_steps, 1)

    _, editing_params.planet_step_scale = imgui.input_float(
        "Step scale", editing_params.planet_step_scale, step=0.01, step_fast=0.05
    )
    _, editing_params.planet_min_step_factor = imgui.input_float(
        "Min step factor", editing_params.planet_min_step_factor, step=0.01, step_fast=0.05
    )

    imgui.separator()
    imgui.text("Cloud raymarch")
    _, editing_params.cloud_max_steps = imgui.input_int(
        "Max c steps", editing_params.cloud_max_steps, step=1, step_fast=10
    )
    editing_params.cloud_max_steps = max(editing_params.cloud_max_steps, 1)

    _, editing_params.cloud_extinction = imgui.input_float(
        "Extinction factor", editing_params.cloud_extinction, step=0.01, step_fast=0.1
    )
    _, editing_params.cloud_phase_exponent = imgui.input_float(
        "Phase exponent", editing_params.cloud_phase_exponent, step=0.1, step_fast=0.5
    )

    imgui.separator()
    imgui.text("Player")
    imgui.text(f"Height above terrain: {player_height:.2f} km")
    imgui.same_line()
    imgui.text_disabled("(read-only)")
    _, min_ground_clearance = imgui.input_float(
        "Min ground clearance (km)", min_ground_clearance, step=0.01, step_fast=0.1
    )
    gravity_clicked = imgui.button("Gravity (G)", width=140)
    imgui.same_line()
    imgui.text("On" if gravity_enabled else "Off")

    imgui.end()
    return gravity_clicked, max(min_ground_clearance, 0.0)


def main():
    if not glfw.init():
        raise RuntimeError("Failed to initialize GLFW")

    glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 4)
    glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 1)
    glfw.window_hint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE)
    glfw.window_hint(glfw.OPENGL_FORWARD_COMPAT, GL_TRUE)

    width, height = 1366, 768
    #Get the primary monitor and its video mode
    #monitor = glfw.get_primary_monitor()
    #mode = glfw.get_video_mode(monitor)
    #width = mode.size.width
    #height = mode.size.height
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
    with open("shaders/surface_info.comp") as f:
        surface_info_src = f.read()

    gbuffer_program = create_program(vert_src, gbuffer_src)
    lighting_program = create_program(vert_src, lighting_src)
    atmosphere_program = create_program(vert_src, atmosphere_src)
    cloud_program = create_program(vert_src, cloud_src)
    composite_program = create_program(vert_src, composite_src)
    surface_info_program = create_compute_program(surface_info_src)

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
    base_speed = 60.0 * SCALAR
    camera.speed = base_speed
    camera.min_radius = None

    renderer = PlanetRenderer(
        gbuffer_program,
        lighting_program,
        atmosphere_program,
        cloud_program,
        composite_program,
        surface_info_program,
        parameters,
    )
    timer = DeltaTimer()
    calendar = PlanetCalendar()

    debug_level = 9
    pressed_state = [False] * 9

    camera_mode = True
    space_pressed = False
    gravity_enabled = False
    g_pressed = False
    gravity_acceleration = 35.0
    min_ground_clearance = 0.0

    last_mouse_x, last_mouse_y = width / 2, height / 2
    first_mouse = True

    glfw.set_input_mode(window, glfw.CURSOR, glfw.CURSOR_DISABLED)

    imgui.create_context()
    imgui_renderer = GlfwRenderer(window)

    prev_planet_to_world = renderer.planet_to_world.copy()
    prev_world_to_planet = renderer.world_to_planet.copy()

    while not glfw.window_should_close(window):
        dt = timer.get_delta()
        calendar_state = calendar.advance(dt, editing_params.time_speed)
        renderer.prepare_frame_state(calendar_state)
        spin_delta = renderer.planet_to_world @ prev_world_to_planet
        glfw.poll_events()
        imgui_renderer.process_inputs()
        imgui.new_frame()

        io = imgui.get_io()

        surface_info = renderer.query_surface_info(camera.position, min_ground_clearance)
        in_atmosphere = np.linalg.norm(camera.position) <= parameters.atmosphere_radius
        if gravity_enabled and in_atmosphere:
            camera.position = spin_delta @ camera.position
            camera.velocity = spin_delta @ camera.velocity
            surface_info = renderer.query_surface_info(camera.position, min_ground_clearance)

        if gravity_enabled and in_atmosphere and surface_info is not None:
            camera.set_reference_up(surface_info["normal"])
        else:
            camera.set_reference_up(WORLD_UP)
        camera.update_vectors()

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

        g_down = glfw.get_key(window, glfw.KEY_G) == glfw.PRESS
        if g_down and not g_pressed:
            gravity_enabled = not gravity_enabled
        g_pressed = g_down

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
            if gravity_enabled and in_atmosphere and surface_info is not None:
                surface_normal = surface_info["normal"]
                tangent_forward = project_to_plane(camera.front, surface_normal)
                if np.linalg.norm(tangent_forward) < 1e-5:
                    tangent_forward = project_to_plane(camera.right, surface_normal)
                tangent_forward = normalize(tangent_forward)
                tangent_right = normalize(np.cross(tangent_forward, surface_normal))

                move_dir = np.zeros(3, dtype=np.float32)
                if glfw.get_key(window, glfw.KEY_W) == glfw.PRESS:
                    move_dir += tangent_forward
                if glfw.get_key(window, glfw.KEY_S) == glfw.PRESS:
                    move_dir -= tangent_forward
                if glfw.get_key(window, glfw.KEY_A) == glfw.PRESS:
                    move_dir -= tangent_right
                if glfw.get_key(window, glfw.KEY_D) == glfw.PRESS:
                    move_dir += tangent_right

                move_len = np.linalg.norm(move_dir)
                if move_len > 1e-6:
                    move_dir = move_dir / move_len
                    camera.position += move_dir * camera.speed * dt
            else:
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
                    debug_level = idx + 1
                pressed_state[idx] = is_pressed

        if gravity_enabled and in_atmosphere and surface_info is not None:
            camera.velocity += (-surface_info["normal"] * gravity_acceleration) * dt
            camera.position += camera.velocity * dt
        else:
            camera.velocity[...] = 0.0

        surface_info = renderer.query_surface_info(camera.position, min_ground_clearance)
        if surface_info is not None and surface_info["altitude"] < min_ground_clearance:
            camera.position = surface_info["normal"] * surface_info["clamped_radius"]
            if gravity_enabled:
                radial_component = np.dot(camera.velocity, surface_info["normal"])
                camera.velocity -= radial_component * surface_info["normal"]

        player_height = max(surface_info["altitude"], 0.0) if surface_info is not None else 0.0
        in_atmosphere = np.linalg.norm(camera.position) <= parameters.atmosphere_radius
        if gravity_enabled and in_atmosphere and surface_info is not None:
            camera.set_reference_up(surface_info["normal"])
        else:
            camera.set_reference_up(WORLD_UP)
        camera.update_vectors()

        framebuffer_width, framebuffer_height = glfw.get_framebuffer_size(window)
        width, height = framebuffer_width or width, framebuffer_height or height

        gravity_clicked, min_ground_clearance = draw_performance_panel(
            editing_params,
            calendar_state,
            calendar.days_in_year,
            gravity_enabled,
            player_height,
            min_ground_clearance,
        )
        if gravity_clicked:
            gravity_enabled = not gravity_enabled
            if gravity_enabled and in_atmosphere and surface_info is not None:
                camera.set_reference_up(surface_info["normal"])
            else:
                camera.set_reference_up(WORLD_UP)
            camera.update_vectors()
        update_clicked, reset_clicked = draw_parameter_panel(editing_params)

        if update_clicked:
            parameters = editing_params.copy()
            renderer.update_parameters(parameters)
            surface_info = renderer.query_surface_info(camera.position, min_ground_clearance)
            if surface_info is not None and surface_info["altitude"] < min_ground_clearance:
                camera.position = surface_info["normal"] * surface_info["clamped_radius"]
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
            debug_level,
            calendar_state,
        )

        imgui.render()
        imgui_renderer.render(imgui.get_draw_data())

        glfw.swap_buffers(window)

        prev_planet_to_world = renderer.planet_to_world.copy()
        prev_world_to_planet = renderer.world_to_planet.copy()

    glfw.terminate()


if __name__ == "__main__":
    main()
