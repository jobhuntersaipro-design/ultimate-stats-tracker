# backend/stats_engine.py
import pandas as pd
import math
from typing import List
from schemas import EventCreate, PlayerStats

def calculate_distance(x1, y1, x2, y2):
    """
    Returns distance in yards using Pythagoras.
    """
    return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)

def process_game_events(events: List[EventCreate]) -> List[PlayerStats]:
    """
    Takes a list of raw events and returns aggregated stats per player.
    """
    # 1. Convert to DataFrame for easier handling
    data = [e.dict() for e in events]
    df = pd.DataFrame(data)
    
    # 2. Sort by time to ensure order
    df = df.sort_values(by='timestamp')
    
    # 3. Initialize stats dictionary
    stats = {}
    
    # 4. Iterate through events to calculate yardage
    # We need to look at the PREVIOUS event to calculate distance to CURRENT event
    for i in range(1, len(df)):
        prev_event = df.iloc[i-1]
        curr_event = df.iloc[i]
        
        player = curr_event['player_name']
        thrower = prev_event['player_name']
        
        # Initialize if not exists
        if player not in stats:
            stats[player] = {'touches': 0, 'throwing_yards': 0, 'receiving_yards': 0, 'turnovers': 0}
        if thrower not in stats:
            stats[thrower] = {'touches': 0, 'throwing_yards': 0, 'receiving_yards': 0, 'turnovers': 0}
            
        # Logic: If current is a catch, the previous thrower gains Throwing Yards
        # and the current catcher gains Receiving Yards.
        if curr_event['action_type'] == 'catch' and prev_event['action_type'] in ['catch', 'pull']:
            dist = calculate_distance(prev_event['x'], prev_event['y'], curr_event['x'], curr_event['y'])
            
            # Credit Thrower
            stats[thrower]['throwing_yards'] += dist
            
            # Credit Receiver
            stats[player]['receiving_yards'] += dist
            stats[player]['touches'] += 1
            
        elif curr_event['action_type'] == 'turnover':
            stats[player]['turnovers'] += 1

    # 5. Convert back to list of Pydantic models
    results = []
    for name, data in stats.items():
        results.append(PlayerStats(
            player_name=name,
            touches=data['touches'],
            throwing_yards=round(data['throwing_yards'], 1),
            receiving_yards=round(data['receiving_yards'], 1),
            turnovers=data['turnovers']
        ))
        
    return results