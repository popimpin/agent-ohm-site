"""Measured RAM READ bandwidth on this laptop (numpy, N threads each summing its own slice of a 4 GiB buffer; numpy releases
the GIL in the reduction). A FLOOR, not a lab number (Intel MLC / STREAM would read higher) - label it that way on screen."""
import numpy as np, threading, time, json, os
GiB = 1 << 30; N = 4 * GiB // 8
a = np.ones(N, dtype=np.int64)            # touch every page first
res = {}
for th in (1, 4, 8, 12, 16, 20):
    parts = np.array_split(a, th); best = 0
    for _ in range(3):
        ts = [threading.Thread(target=np.sum, args=(p,)) for p in parts]
        t0 = time.perf_counter(); [t.start() for t in ts]; [t.join() for t in ts]; dt = time.perf_counter() - t0
        best = max(best, a.nbytes / dt / 1e9)
    res[th] = round(best, 1); print(f'{th:2d} threads: {best:5.1f} GB/s', flush=True)
json.dump({'measured_at': time.strftime('%Y-%m-%d %H:%M'), 'method': 'numpy threaded sum over 4 GiB int64, best of 3',
           'read_GBps_by_threads': res}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ram_bw.json'), 'w'), indent=1)
