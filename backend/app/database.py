from __future__ import annotations

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()


# Use data directory for database file
DB_DIR = os.getenv("DB_DIR", "/app/data")
try:
    os.makedirs(DB_DIR, exist_ok=True)
except OSError:
    pass  # Directory might already exist or be created by volume mount
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_DIR}/sales_training.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

