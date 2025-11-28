import React, { useState, useRef } from 'react';
import axios from 'axios';
import { Circle, Trash2, Send } from 'lucide-react';

// --- Types ---
type Coordinate = { x: number; y: number };

type EventLog = {
  id: number;
  type: 'pull' | 'catch' | 'turnover' | 'goal';
  location: Coordinate;
  playerName: string; 
  timestamp: string;
};

// Data shape returned from Python
type PlayerStats = {
  player_name: string;
  touches: number;
  throwing_yards: number;
  receiving_yards: number;
  turnovers: number;
};

const FIELD_WIDTH = 40;
const FIELD_LENGTH = 110;

const PitchMap: React.FC = () => {
  const [events, setEvents] = useState<EventLog[]>([]);
  const [gameState, setGameState] = useState<'offense' | 'defense'>('offense');
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const svgRef = useRef<SVGSVGElement>(null);

  // Helper: Convert screen click to SVG coordinates
  const getCoordinates = (e: React.MouseEvent<SVGSVGElement>): Coordinate => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    return {
      x: (e.clientX - CTM.e) / CTM.a,
      y: (e.clientY - CTM.f) / CTM.d
    };
  };

  const handleFieldClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = getCoordinates(e);
    
    // Simulate alternating players for demo purposes
    // In a real app, you'd select the player from a roster button first
    const currentPlayer = events.length % 2 === 0 ? "Player A" : "Player B";

    const newEvent: EventLog = {
      id: Date.now(),
      type: gameState === 'offense' ? 'catch' : 'turnover',
      location: { x, y },
      playerName: currentPlayer,
      timestamp: new Date().toISOString()
    };

    setEvents((prev) => [...prev, newEvent]);
  };

  const handleTurnover = () => {
    setGameState(prev => prev === 'offense' ? 'defense' : 'offense');
  };

  const submitStats = async () => {
    if (events.length === 0) return;
    setIsLoading(true);

    // Transform frontend state to Backend Schema
    const payload = {
      events: events.map(e => ({
        player_name: e.playerName,
        action_type: e.type,
        x: e.location.x,
        y: e.location.y,
        timestamp: e.timestamp
      }))
    };

    try {
      const response = await axios.post('http://127.0.0.1:8000/calculate-stats/', payload);
      setStats(response.data);
    } catch (error) {
      console.error("Error fetching stats:", error);
      alert("Failed to calculate stats. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 p-4 bg-gray-900 min-h-screen text-white justify-center">
      
      {/* LEFT COLUMN: Controls & Field */}
      <div className="flex flex-col items-center">
        <h2 className="text-xl font-bold mb-4">Live Tracker: <span className={gameState === 'offense' ? 'text-green-400' : 'text-red-400'}>{gameState.toUpperCase()}</span></h2>
        
        <div className="mb-4 flex gap-4">
          <button onClick={handleTurnover} className="px-4 py-2 bg-red-600 rounded hover:bg-red-700 font-bold shadow">
            Force Turn
          </button>
          <button onClick={() => setEvents([])} className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700 shadow flex items-center gap-2">
            <Trash2 size={16} /> Reset
          </button>
          <button onClick={submitStats} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 shadow font-bold flex items-center gap-2">
            <Send size={16} /> Calculate Stats
          </button>
        </div>

        <div className="relative border-2 border-white rounded shadow-2xl">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_LENGTH}`}
            className="h-[70vh] w-auto bg-green-700 cursor-crosshair touch-none"
            onClick={handleFieldClick}
          >
            {/* Field Markings */}
            <rect x="0" y="0" width="40" height="20" fill="rgba(255,255,255,0.1)" />
            <line x1="0" y1="20" x2="40" y2="20" stroke="white" strokeWidth="0.5" />
            <rect x="0" y="90" width="40" height="20" fill="rgba(255,255,255,0.1)" />
            <line x1="0" y1="90" x2="40" y2="90" stroke="white" strokeWidth="0.5" />
            <line x1="19" y1="40" x2="21" y2="40" stroke="white" strokeWidth="0.5" />
            <line x1="19" y1="70" x2="21" y2="70" stroke="white" strokeWidth="0.5" />

            {/* Trajectory Lines */}
            {events.map((evt, index) => {
              if (index === 0) return null;
              const prev = events[index - 1];
              return (
                <line
                  key={`line-${evt.id}`}
                  x1={prev.location.x}
                  y1={prev.location.y}
                  x2={evt.location.x}
                  y2={evt.location.y}
                  stroke="yellow"
                  strokeWidth="0.5"
                  strokeDasharray="1,0.5"
                  opacity="0.8"
                />
              );
            })}

            {/* Event Markers */}
            {events.map((evt, index) => (
              <circle
                key={evt.id}
                cx={evt.location.x}
                cy={evt.location.y}
                r="1"
                fill={index === 0 ? "white" : "yellow"}
                stroke="black"
                strokeWidth="0.1"
              />
            ))}
          </svg>
        </div>
      </div>

      {/* RIGHT COLUMN: Stats Table */}
      <div className="w-full md:w-96 bg-gray-800 p-6 rounded-xl shadow-lg h-fit">
        <h3 className="text-xl font-bold mb-4 border-b border-gray-600 pb-2">Game Stats</h3>
        
        {stats.length === 0 ? (
          <p className="text-gray-400 italic">Record events and click "Calculate Stats" to see metrics.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400 uppercase bg-gray-700">
                <tr>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Throw Yds</th>
                  <th className="px-3 py-2">Rec Yds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {stats.map((s) => (
                  <tr key={s.player_name} className="hover:bg-gray-700/50">
                    <td className="px-3 py-2 font-medium">{s.player_name}</td>
                    <td className="px-3 py-2 text-blue-400">{s.throwing_yards}</td>
                    <td className="px-3 py-2 text-green-400">{s.receiving_yards}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default PitchMap;    