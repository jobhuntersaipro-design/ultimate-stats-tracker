# backend/main.py
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List  # <--- THIS WAS MISSING

from database import engine, Base, get_db
import models
from schemas import GameSequence, PlayerStats
from stats_engine import process_game_events

# Create the database tables automatically
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Allow the frontend to talk to the backend (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Ultimate Frisbee Stats API is running!"}

@app.get("/players/")
def read_players(db: Session = Depends(get_db)):
    return db.query(models.Player).all()

@app.post("/calculate-stats/", response_model=List[PlayerStats])
def calculate_stats(sequence: GameSequence):
    """
    Receives a list of raw events (clicks) and returns calculated stats.
    """
    stats = process_game_events(sequence.events)
    return stats