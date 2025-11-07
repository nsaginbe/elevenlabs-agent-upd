from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import sessions


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title="MoonAI Sales Trainer", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"]
        ,
        allow_headers=["*"],
    )

    @app.get("/health")
    def healthcheck():
        return {"status": "ok"}

    app.include_router(sessions.router)

    return app


app = create_app()
