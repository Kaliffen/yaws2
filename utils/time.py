import time
from dataclasses import dataclass


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
