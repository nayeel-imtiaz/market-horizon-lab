from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from backend.main import configure_cors
from backend.rate_limit import ForecastRateLimit


def make_app(clock, *, render_proxy=False):
    app = FastAPI()
    app.add_middleware(ForecastRateLimit, clock=clock, per_client=2, total=3, render_proxy=render_proxy)
    configure_cors(app, "https://demo.example.com")

    @app.get("/market-forecast")
    @app.get("/demo")
    @app.get("/health")
    async def ok():
        return {"status": "ok"}

    @app.post("/upload-csv")
    async def upload(request: Request):
        return {"bytes": len(await request.body())}

    return app


def test_routes_share_budget_and_block_upload_before_reading_body():
    now = [0]
    with TestClient(make_app(lambda: now[0])) as client:
        assert client.get("/market-forecast").status_code == 200
        assert client.get("/demo/").status_code == 200
        now[0] = 15

        def unexpected_body():
            raise AssertionError("Rate-limited upload consumed its body")
            yield b""

        response = client.post("/upload-csv", content=unexpected_body(), headers={"Origin": "https://demo.example.com"})
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "45"
        assert response.headers["Access-Control-Allow-Origin"] == "https://demo.example.com"
        assert client.get("/health").status_code == 200
        now[0] = 60
        assert client.post("/upload-csv", content=b"csv").json() == {"bytes": 3}


def test_render_client_ips_and_shared_service_budget():
    with TestClient(make_app(lambda: 0, render_proxy=True)) as client:
        for supplied in ("198.51.100.1", "198.51.100.2"):
            assert client.get("/demo", headers={"X-Forwarded-For": f"{supplied}, 203.0.113.1"}).status_code == 200
        assert client.get("/demo", headers={"X-Forwarded-For": "198.51.100.3, 203.0.113.1"}).status_code == 429
        assert client.get("/demo", headers={"X-Forwarded-For": "203.0.113.2"}).status_code == 200
        assert client.get("/demo", headers={"X-Forwarded-For": "203.0.113.3"}).status_code == 429


def test_forwarded_address_is_ignored_outside_render():
    with TestClient(make_app(lambda: 0)) as client:
        for address in ("203.0.113.1", "203.0.113.2"):
            assert client.get("/demo", headers={"X-Forwarded-For": address}).status_code == 200
        assert client.get("/demo", headers={"X-Forwarded-For": "203.0.113.3"}).status_code == 429
