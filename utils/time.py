import time
from dataclasses import dataclass
import time

import numpy as np


class DeltaTimer:
    def __init__(self):
        self.last = time.time()

    def get_delta(self):
        now = time.time()
        dt = now - self.last
        self.last = now
        return dt


@dataclass
class CalendarState:
    day_index: int
    day_fraction: float
    year_fraction: float
    hour: int
    minute: int
    second: int
    elapsed_seconds: float


class PlanetCalendar:
    def __init__(self, days_in_year: int = 365, hours_per_day: int = 24):
        self.days_in_year = days_in_year
        self.hours_per_day = hours_per_day
        self.seconds_per_day = hours_per_day * 3600
        self.seconds_per_year = self.seconds_per_day * days_in_year
        self.elapsed_seconds = 0.0

    def advance(self, dt: float, time_speed: float) -> CalendarState:
        time_speed = max(time_speed, 0.0)
        self.elapsed_seconds = (self.elapsed_seconds + dt * time_speed) % self.seconds_per_year
        return self._state_from_elapsed()

    def set_time(self, day_index: int, hour: int, minute: int, second: int) -> CalendarState:
        day_index = max(0, min(self.days_in_year - 1, day_index))
        hour = max(0, min(self.hours_per_day - 1, hour))
        minute = max(0, min(59, minute))
        second = max(0, min(59, second))

        seconds_into_day = hour * 3600 + minute * 60 + second
        self.elapsed_seconds = (day_index * self.seconds_per_day + seconds_into_day) % self.seconds_per_year
        return self._state_from_elapsed()

    def _state_from_elapsed(self) -> CalendarState:
        total_seconds = self.elapsed_seconds
        day_index = int(total_seconds // self.seconds_per_day)
        seconds_into_day = total_seconds - day_index * self.seconds_per_day
        hour = int(seconds_into_day // 3600)
        minute = int((seconds_into_day % 3600) // 60)
        second = int(seconds_into_day % 60)
        day_fraction = seconds_into_day / self.seconds_per_day
        year_fraction = total_seconds / self.seconds_per_year
        return CalendarState(
            day_index=day_index,
            day_fraction=day_fraction,
            year_fraction=year_fraction,
            hour=hour,
            minute=minute,
            second=second,
            elapsed_seconds=total_seconds,
        )

    def current_state(self) -> CalendarState:
        return self._state_from_elapsed()


def compute_sun_direction(day_fraction: float, year_fraction: float, tilt_degrees: float) -> np.ndarray:
    """Compute a normalized sun direction based on time-of-day and season."""

    declination = np.deg2rad(tilt_degrees) * np.sin(2.0 * np.pi * year_fraction)
    hour_angle = 2.0 * np.pi * (day_fraction - 0.5)
    cos_decl = np.cos(declination)

    sun_dir = np.array(
        [
            cos_decl * np.cos(hour_angle),
            np.sin(declination),
            cos_decl * np.sin(hour_angle),
        ],
        dtype=np.float32,
    )

    norm = np.linalg.norm(sun_dir)
    if norm > 1e-6:
        sun_dir /= norm

    return sun_dir


def _rotation_matrix(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    axis = axis / np.linalg.norm(axis)
    c = np.cos(angle_rad)
    s = np.sin(angle_rad)
    t = 1.0 - c
    x, y, z = axis
    return np.array(
        [
            [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
            [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
            [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
        ],
        dtype=np.float32,
    )


def compute_moon_direction(
    total_days: float,
    sun_direction: np.ndarray,
    tilt_degrees: float,
    lunar_cycle_days: float = 29.53,
    inclination_degrees: float = 5.0,
) -> np.ndarray:
    """Compute a moon direction that maintains a realistic angle to the sun.

    The moon orbits once every ``lunar_cycle_days`` with a slight inclination from
    the planet's equatorial plane. The orbit progresses relative to the sun so the
    bright side generally faces the night hemisphere instead of aligning with the
    sunlit side.
    """

    orbit_fraction = (total_days % lunar_cycle_days) / lunar_cycle_days
    orbital_angle = 2.0 * np.pi * orbit_fraction + np.pi

    base_dir = np.array(sun_direction, dtype=np.float32)
    if np.linalg.norm(base_dir) < 1e-6:
        base_dir = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    else:
        base_dir /= np.linalg.norm(base_dir)

    up_axis = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    moon_in_plane = _rotation_matrix(up_axis, orbital_angle) @ base_dir

    incl = np.deg2rad(inclination_degrees)
    tilt = np.deg2rad(tilt_degrees)
    inclination_axis = np.cross(up_axis, moon_in_plane)
    if np.linalg.norm(inclination_axis) < 1e-6:
        inclination_axis = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    inclination_axis /= np.linalg.norm(inclination_axis)

    tilt_matrix = np.array(
        [[1.0, 0.0, 0.0], [0.0, np.cos(tilt), -np.sin(tilt)], [0.0, np.sin(tilt), np.cos(tilt)]],
        dtype=np.float32,
    )

    inclined_dir = _rotation_matrix(inclination_axis, incl) @ moon_in_plane
    moon_dir = tilt_matrix @ inclined_dir

    norm = np.linalg.norm(moon_dir)
    if norm > 1e-6:
        moon_dir /= norm

    return moon_dir
