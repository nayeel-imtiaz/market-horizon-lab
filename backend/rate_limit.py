"""Bound forecast traffic within a single API worker."""

from collections import Counter, deque
from ipaddress import ip_address
from math import ceil
from threading import Lock
from time import monotonic

from starlette.requests import Request
from starlette.responses import JSONResponse

PROTECTED_ROUTES = {("GET", "/market-forecast"), ("GET", "/demo"), ("POST", "/upload-csv")}


class ForecastRateLimit:
    """Share a sliding-window budget across the compute-intensive routes."""

    def __init__(self, app, *, render_proxy=False, per_client=10, total=60, window=60, clock=monotonic):
        self.app = app
        self.render_proxy = render_proxy
        self.per_client = per_client
        self.total = total
        self.window = window
        self.clock = clock
        self.requests = deque()
        self.counts = Counter()
        self.lock = Lock()

    def client_key(self, request):
        # Render appends the visitor IP after any caller-supplied entries.
        forwarded = request.headers.getlist("x-forwarded-for") if self.render_proxy else []
        address = forwarded[-1].rsplit(",", 1)[-1].strip() if forwarded else ""
        try:
            return str(ip_address(address))
        except ValueError:
            return request.client.host if request.client else "unknown"

    def retry_after(self, client):
        with self.lock:
            now = self.clock()
            while self.requests and now - self.requests[0][0] >= self.window:
                _, expired_client = self.requests.popleft()
                self.counts[expired_client] -= 1
                if self.counts[expired_client] == 0:
                    del self.counts[expired_client]

            if self.counts[client] >= self.per_client:
                first = next(timestamp for timestamp, key in self.requests if key == client)
            elif len(self.requests) >= self.total:
                first = self.requests[0][0]
            else:
                self.requests.append((now, client))
                self.counts[client] += 1
                return None
            return max(1, ceil(self.window - (now - first)))

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and (scope["method"], scope["path"]) in PROTECTED_ROUTES:
            retry = self.retry_after(self.client_key(Request(scope)))
            if retry is not None:
                response = JSONResponse(
                    {"detail": f"Forecast rate limit reached. Try again in {retry} seconds."},
                    status_code=429,
                    headers={"Retry-After": str(retry), "Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
