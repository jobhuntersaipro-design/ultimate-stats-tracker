from enum import Enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Boolean, Enum as SAEnum
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()

# --- Enums for Standardization ---
class TeamSide(str, Enum):
    HOME = "home"
    AWAY = "away"

class ActionType(str, Enum):
    PULL = "pull"
    CATCH = "catch"
    GOAL = "goal"
    THROWAWAY = "throwaway"
    DROP = "drop"
    STALL = "stall"
    DEFENSE_BLOCK = "defense_block"
    CALLAHAN = "callahan"

# --- Models ---

class Game(Base):
    __tablename__ = 'games'
    id = Column(Integer, primary_key=True, index=True)
    tournament_name = Column(String)
    opponent_name = Column(String)
    date = Column(DateTime, default=datetime.utcnow)
    # Field conditions can affect stats (wind/rain)
    weather_condition = Column(String, nullable=True) 
    
    points = relationship("Point", back_populates="game")

class Player(Base):
    __tablename__ = 'players'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    jersey_number = Column(Integer)
    # Important for mixed division ratio tracking
    gender_match = Column(String) 
    
class Point(Base):
    __tablename__ = 'points'
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey('games.id'))
    
    # Snapshot of score at start of point
    score_home = Column(Integer)
    score_away = Column(Integer)
    
    # "O" or "D" point
    starting_stance = Column(String) 
    
    game = relationship("Game", back_populates="points")
    events = relationship("Event", back_populates="point")

class Event(Base):
    """
    The Atomic Unit. 
    Stores the 'Result' of an action at a specific location.
    """
    __tablename__ = 'events'
    id = Column(Integer, primary_key=True, index=True)
    point_id = Column(Integer, ForeignKey('points.id'))
    
    # The primary actor (Thrower for passes, Defender for blocks)
    player_id = Column(Integer, ForeignKey('players.id'))
    
    # The receiver (Null if it's a drop, stall, or throwaway)
    receiver_id = Column(Integer, ForeignKey('players.id'), nullable=True)
    
    action_type = Column(SAEnum(ActionType))
    
    # Coordinates (0-100 scale or Yards)
    # Recommendation: Use 0-110 for Y (length) and 0-40 for X (width)
    x_coordinate = Column(Float)
    y_coordinate = Column(Float)
    
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    point = relationship("Point", back_populates="events")