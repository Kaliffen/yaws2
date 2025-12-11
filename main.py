import sys
import numpy as np
from OpenGL.GL import *
from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtOpenGLWidgets import QOpenGLWidget

from gl_utils.camera import FPSCamera
from gl_utils.program import create_program
from rendering.constants import PlanetParameters
from rendering.planet_renderer import PlanetRenderer
from utils.time import DeltaTimer


def compute_adaptive_speed(position, base_speed, planet_radius):
    distance = np.linalg.norm(position)
    distance_ratio = distance / planet_radius
    adaptive_factor = np.clip(0.15 + distance_ratio * 0.85, 0.15, 4.0)
    return base_speed * adaptive_factor


def _normalize(vec):
    norm = np.linalg.norm(vec)
    if norm < 1e-6:
        return vec
    return vec / norm


class PlanetWidget(QOpenGLWidget):
    def __init__(self, parameters: PlanetParameters, parent=None):
        super().__init__(parent)
        self.setFormat(QtGui.QSurfaceFormat.defaultFormat())
        self.parameters = parameters
        self.quad_vao = None
        self.quad_vao_obj: QtGui.QOpenGLVertexArrayObject | None = None
        self.quad_vbo = None
        self.renderer = None
        self.camera = None
        self.layer_visibility = [False] * 9
        self.key_states: dict[int, bool] = {}
        self.base_speed = 60.0
        self.delta_timer = DeltaTimer()
        self.last_mouse_pos: QtCore.QPointF | None = None

        self.setFocusPolicy(QtCore.Qt.StrongFocus)
        self.setMouseTracking(True)
        self.setCursor(QtCore.Qt.CursorShape.BlankCursor)

        self.render_timer = QtCore.QTimer(self)
        self.render_timer.timeout.connect(self.update_scene)
        self.render_timer.start(0)

    def sizeHint(self):
        return QtCore.QSize(1280, 720)

    def initializeGL(self):
        glEnable(GL_DEPTH_TEST)
        self._create_quad()

        version = glGetString(GL_VERSION)
        renderer = glGetString(GL_RENDERER)
        if version is not None and renderer is not None:
            print(f"GL version: {version.decode('utf-8')}, renderer: {renderer.decode('utf-8')}")

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

        self.renderer = PlanetRenderer(
            gbuffer_program,
            lighting_program,
            atmosphere_program,
            cloud_program,
            composite_program,
            self.parameters,
        )

        self.camera = FPSCamera(
            position=np.array([0.0, 0.0, self.parameters.planet_radius * 1.6], dtype=np.float32),
            yaw=-90.0,
            pitch=0.0,
        )
        self.camera.speed = self.base_speed
        self._update_camera_bounds()

    def _create_quad(self):
        self.quad_vao_obj = QtGui.QOpenGLVertexArrayObject(self)
        if not self.quad_vao_obj.create():
            raise RuntimeError("Failed to create vertex array object")

        vertices = np.array(
            [
                -1.0,
                -1.0,
                1.0,
                -1.0,
                1.0,
                1.0,
                -1.0,
                -1.0,
                1.0,
                1.0,
                -1.0,
                1.0,
            ],
            dtype=np.float32,
        )

        with QtGui.QOpenGLVertexArrayObject.Binder(self.quad_vao_obj):
            self.quad_vbo = glGenBuffers(1)
            glBindBuffer(GL_ARRAY_BUFFER, self.quad_vbo)
            glBufferData(GL_ARRAY_BUFFER, vertices.nbytes, vertices, GL_STATIC_DRAW)

            glEnableVertexAttribArray(0)
            glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * 4, None)

        glBindBuffer(GL_ARRAY_BUFFER, 0)
        self.quad_vao = self.quad_vao_obj.objectId()

    def _update_camera_bounds(self):
        if not self.camera:
            return
        surface_radius = self.parameters.planet_radius + self.parameters.height_scale
        self.camera.min_radius = surface_radius - self.parameters.height_scale * 0.95
        dist = np.linalg.norm(self.camera.position)
        if dist < self.camera.min_radius:
            direction = _normalize(self.camera.position)
            if np.linalg.norm(direction) < 1e-6:
                direction = np.array([0.0, 0.0, 1.0], dtype=np.float32)
            self.camera.position = direction * self.camera.min_radius

    def update_scene(self):
        if not self.renderer or not self.camera:
            return
        dt = self.delta_timer.get_delta()
        self._handle_movement(dt)
        self.update()

    def _handle_movement(self, dt: float):
        speed_multiplier = 10.0 if self.key_states.get(QtCore.Qt.Key_Shift, False) else 1.0
        self.camera.speed = compute_adaptive_speed(
            self.camera.position, self.base_speed, self.parameters.planet_radius
        ) * speed_multiplier

        if self.key_states.get(QtCore.Qt.Key_W, False):
            self.camera.process_movement("FORWARD", dt)
        if self.key_states.get(QtCore.Qt.Key_S, False):
            self.camera.process_movement("BACKWARD", dt)
        if self.key_states.get(QtCore.Qt.Key_A, False):
            self.camera.process_movement("LEFT", dt)
        if self.key_states.get(QtCore.Qt.Key_D, False):
            self.camera.process_movement("RIGHT", dt)

    def paintGL(self):
        if not self.renderer or not self.camera:
            return
        dpr = self.devicePixelRatioF()
        target_width = int(self.width() * dpr)
        target_height = int(self.height() * dpr)
        if self.quad_vao_obj:
            with QtGui.QOpenGLVertexArrayObject.Binder(self.quad_vao_obj):
                self.renderer.render(
                    self.camera.position,
                    self.camera.front,
                    self.camera.right,
                    self.camera.up,
                    target_width,
                    target_height,
                    self.layer_visibility,
                )
        else:
            self.renderer.render(
                self.camera.position,
                self.camera.front,
                self.camera.right,
                self.camera.up,
                target_width,
                target_height,
                self.layer_visibility,
            )

    def mouseMoveEvent(self, event: QtGui.QMouseEvent):
        pos = event.position()
        if self.camera is None:
            return
        if self.last_mouse_pos is None:
            self.last_mouse_pos = pos
            return
        xoff = pos.x() - self.last_mouse_pos.x()
        yoff = self.last_mouse_pos.y() - pos.y()
        self.last_mouse_pos = pos
        self.camera.process_mouse(xoff, yoff)

    def enterEvent(self, event):
        super().enterEvent(event)
        self.last_mouse_pos = None

    def keyPressEvent(self, event: QtGui.QKeyEvent):
        if event.isAutoRepeat():
            return
        key = event.key()
        self.key_states[key] = True
        if QtCore.Qt.Key_1 <= key <= QtCore.Qt.Key_9:
            idx = key - QtCore.Qt.Key_1
            self.layer_visibility[idx] = not self.layer_visibility[idx]
        elif key == QtCore.Qt.Key_Escape:
            window = self.window()
            if window:
                window.close()
        super().keyPressEvent(event)

    def keyReleaseEvent(self, event: QtGui.QKeyEvent):
        if event.isAutoRepeat():
            return
        key = event.key()
        self.key_states[key] = False
        super().keyReleaseEvent(event)

    def on_parameters_updated(self):
        self._update_camera_bounds()
        self.update()


class ParameterDock(QtWidgets.QDockWidget):
    def __init__(self, parameters: PlanetParameters, on_change, parent=None):
        super().__init__("Parameters", parent)
        self.parameters = parameters
        self.on_change = on_change
        self.setAllowedAreas(QtCore.Qt.RightDockWidgetArea)

        content = QtWidgets.QWidget()
        content_layout = QtWidgets.QVBoxLayout(content)

        content_layout.addWidget(self._build_planet_group())
        content_layout.addWidget(self._build_water_group())
        content_layout.addWidget(self._build_cloud_group())
        content_layout.addStretch(1)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(content)
        self.setWidget(scroll)

    def _make_spin(self, value, minimum, maximum, step, decimals=2):
        spin = QtWidgets.QDoubleSpinBox()
        spin.setRange(minimum, maximum)
        spin.setDecimals(decimals)
        spin.setSingleStep(step)
        spin.setValue(value)
        return spin

    def _build_planet_group(self):
        group = QtWidgets.QGroupBox("Planet")
        form = QtWidgets.QFormLayout()

        self.planet_radius_spin = self._make_spin(self.parameters.planet_radius, 1000.0, 15000.0, 10.0, 2)
        self.planet_radius_spin.valueChanged.connect(self._update_planet_radius)
        form.addRow("Planet radius (km)", self.planet_radius_spin)

        self.atmosphere_radius_spin = self._make_spin(
            self.parameters.atmosphere_radius, self.parameters.planet_radius + 1.0, 20000.0, 10.0, 2
        )
        self.atmosphere_radius_spin.valueChanged.connect(self._update_atmosphere_radius)
        form.addRow("Atmosphere radius (km)", self.atmosphere_radius_spin)

        self.height_scale_spin = self._make_spin(self.parameters.height_scale, 0.0, 2000.0, 1.0, 2)
        self.height_scale_spin.valueChanged.connect(self._update_height_scale)
        form.addRow("Height scale (km)", self.height_scale_spin)

        self.sea_level_spin = self._make_spin(self.parameters.sea_level, -500.0, 500.0, 1.0, 2)
        self.sea_level_spin.valueChanged.connect(self._update_sea_level)
        form.addRow("Sea level offset (km)", self.sea_level_spin)

        self.max_distance_spin = self._make_spin(self.parameters.max_ray_distance, 1000.0, 40000.0, 50.0, 2)
        self.max_distance_spin.valueChanged.connect(self._update_max_distance)
        form.addRow("Max ray distance", self.max_distance_spin)

        sun_layout = QtWidgets.QHBoxLayout()
        self.sun_dir_spins = []
        for val in self.parameters.sun_direction:
            spin = self._make_spin(float(val), -1.0, 1.0, 0.05, 3)
            spin.valueChanged.connect(self._update_sun_direction)
            sun_layout.addWidget(spin)
            self.sun_dir_spins.append(spin)
        form.addRow("Sun direction", sun_layout)

        group.setLayout(form)
        return group

    def _build_water_group(self):
        group = QtWidgets.QGroupBox("Water")
        form = QtWidgets.QFormLayout()

        water_layout = QtWidgets.QHBoxLayout()
        self.water_color_spins = []
        for val in self.parameters.water_color:
            spin = self._make_spin(float(val), 0.0, 1.5, 0.01, 3)
            spin.valueChanged.connect(self._update_water_color)
            water_layout.addWidget(spin)
            self.water_color_spins.append(spin)
        form.addRow("Water color", water_layout)

        self.water_absorption_spin = self._make_spin(self.parameters.water_absorption, 0.0, 5.0, 0.01, 3)
        self.water_absorption_spin.valueChanged.connect(self._update_water_absorption)
        form.addRow("Water absorption", self.water_absorption_spin)

        self.water_scattering_spin = self._make_spin(self.parameters.water_scattering, 0.0, 5.0, 0.01, 3)
        self.water_scattering_spin.valueChanged.connect(self._update_water_scattering)
        form.addRow("Water scattering", self.water_scattering_spin)

        group.setLayout(form)
        return group

    def _build_cloud_group(self):
        group = QtWidgets.QGroupBox("Clouds")
        form = QtWidgets.QFormLayout()

        self.cloud_base_spin = self._make_spin(self.parameters.cloud_base_altitude, 0.0, 100.0, 0.1, 2)
        self.cloud_base_spin.valueChanged.connect(self._update_cloud_base)
        form.addRow("Base altitude (km)", self.cloud_base_spin)

        self.cloud_thickness_spin = self._make_spin(self.parameters.cloud_layer_thickness, 0.0, 100.0, 0.1, 2)
        self.cloud_thickness_spin.valueChanged.connect(self._update_cloud_thickness)
        form.addRow("Layer thickness (km)", self.cloud_thickness_spin)

        self.cloud_coverage_spin = self._make_spin(self.parameters.cloud_coverage, 0.0, 1.0, 0.01, 3)
        self.cloud_coverage_spin.valueChanged.connect(self._update_cloud_coverage)
        form.addRow("Coverage", self.cloud_coverage_spin)

        self.cloud_density_spin = self._make_spin(self.parameters.cloud_density, 0.0, 1.5, 0.01, 3)
        self.cloud_density_spin.valueChanged.connect(self._update_cloud_density)
        form.addRow("Density", self.cloud_density_spin)

        cloud_light_layout = QtWidgets.QHBoxLayout()
        self.cloud_light_spins = []
        for val in self.parameters.cloud_light_color:
            spin = self._make_spin(float(val), 0.0, 2.5, 0.01, 3)
            spin.valueChanged.connect(self._update_cloud_light)
            cloud_light_layout.addWidget(spin)
            self.cloud_light_spins.append(spin)
        form.addRow("Light color", cloud_light_layout)

        group.setLayout(form)
        return group

    def _update_planet_radius(self, value):
        self.parameters.planet_radius = float(value)
        minimum_atmosphere = self.parameters.planet_radius + 1.0
        self.atmosphere_radius_spin.setMinimum(minimum_atmosphere)
        if self.atmosphere_radius_spin.value() < minimum_atmosphere:
            self.atmosphere_radius_spin.blockSignals(True)
            self.atmosphere_radius_spin.setValue(minimum_atmosphere)
            self.atmosphere_radius_spin.blockSignals(False)
            self.parameters.atmosphere_radius = minimum_atmosphere
        self.on_change()

    def _update_atmosphere_radius(self, value):
        self.parameters.atmosphere_radius = float(value)
        self.on_change()

    def _update_height_scale(self, value):
        self.parameters.height_scale = float(value)
        self.on_change()

    def _update_sea_level(self, value):
        self.parameters.sea_level = float(value)
        self.on_change()

    def _update_max_distance(self, value):
        self.parameters.max_ray_distance = float(value)
        self.on_change()

    def _update_sun_direction(self):
        vec = np.array([spin.value() for spin in self.sun_dir_spins], dtype=np.float32)
        norm = np.linalg.norm(vec)
        self.parameters.sun_direction = vec if norm < 1e-6 else vec / norm
        self.on_change()

    def _update_water_color(self):
        self.parameters.water_color = np.array([spin.value() for spin in self.water_color_spins], dtype=np.float32)
        self.on_change()

    def _update_water_absorption(self, value):
        self.parameters.water_absorption = float(value)
        self.on_change()

    def _update_water_scattering(self, value):
        self.parameters.water_scattering = float(value)
        self.on_change()

    def _update_cloud_base(self, value):
        self.parameters.cloud_base_altitude = float(value)
        self.on_change()

    def _update_cloud_thickness(self, value):
        self.parameters.cloud_layer_thickness = float(value)
        self.on_change()

    def _update_cloud_coverage(self, value):
        self.parameters.cloud_coverage = float(value)
        self.on_change()

    def _update_cloud_density(self, value):
        self.parameters.cloud_density = float(value)
        self.on_change()

    def _update_cloud_light(self):
        self.parameters.cloud_light_color = np.array([spin.value() for spin in self.cloud_light_spins], dtype=np.float32)
        self.on_change()


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.parameters = PlanetParameters()
        self.gl_widget = PlanetWidget(self.parameters)
        self.setCentralWidget(self.gl_widget)

        self.parameter_dock = ParameterDock(self.parameters, self._on_parameters_changed, self)
        self.addDockWidget(QtCore.Qt.RightDockWidgetArea, self.parameter_dock)

        self.setWindowTitle("SDF Planet (Qt)")

    def _on_parameters_changed(self):
        self.gl_widget.on_parameters_updated()


def main():
    fmt = QtGui.QSurfaceFormat()
    fmt.setRenderableType(QtGui.QSurfaceFormat.OpenGL)
    fmt.setVersion(4, 1)
    fmt.setProfile(QtGui.QSurfaceFormat.CoreProfile)
    fmt.setDepthBufferSize(24)
    fmt.setStencilBufferSize(8)
    QtGui.QSurfaceFormat.setDefaultFormat(fmt)

    QtCore.QCoreApplication.setAttribute(QtCore.Qt.AA_UseDesktopOpenGL)

    app = QtWidgets.QApplication(sys.argv)

    window = MainWindow()
    window.resize(1600, 900)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
