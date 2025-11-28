# backend/schemas.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# --- Incoming Data (What the Frontend sends) ---
class EventCreate(BaseModel):
    # We use string for player_name for now to keep it simple
    player_name: str 
    action_type: str  # "catch", "pull", "turnover"
    x: float
    y: float
    timestamp: datetime

class GameSequence(BaseModel):
    # A list of events represents one full point or game
    events: List[EventCreate]

# --- Outgoing Data (What the Backend calculates) ---
class PlayerStats(BaseModel):
    player_name: str
    touches: int
    throwing_yards: float
    receiving_yards: float
    turnovers: int