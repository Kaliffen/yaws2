import time


class DeltaTimer:
    def __init__(self):
        self.last = time.time()

    def get_delta(self):
        now = time.time()
        dt = now - self.last
        self.last = now
        return dt
