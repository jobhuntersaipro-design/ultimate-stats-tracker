import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Send, Users, RotateCcw, ScrollText, Trophy, Pencil, XCircle, Clock, Activity, Hash } from 'lucide-react';

// --- Types ---
type Coordinate = { x: number; y: number };

type Player = {
  id: string;
  name: string;
  number: number;
  gender: 'M' | 'F';
};

type EventLog = {
  id: number;
  type: 'pull' | 'catch' | 'turnover' | 'goal';
  location: Coordinate;
  player_name: string; 
  thrower_name?: string; 
  timestamp: string;
  dist_meters?: number;
  pass_number?: number; 
};

// --- Constants ---
const FIELD_WIDTH = 40;
const FIELD_LENGTH = 110;
const ENDZONE_DEPTH = 20;
const YARDS_TO_METERS = 0.9144; 

const MALE_AVATAR = "https://api.dicebear.com/9.x/micah/svg?seed=Felix&backgroundColor=b6e3f4";
const FEMALE_AVATAR = "https://api.dicebear.com/9.x/micah/svg?seed=Amala&backgroundColor=ffdfbf";

const TEAM_ROSTER: Player[] = [
  { id: 'p7', name: 'Greg', number: 0, gender: 'M' },
  { id: 'p5', name: 'Evan', number: 4, gender: 'M' },
  { id: 'p3', name: 'Connor', number: 7, gender: 'M' },
  { id: 'p10', name: 'Jenny', number: 10, gender: 'F' },
  { id: 'p1', name: 'Alex', number: 12, gender: 'M' },
  { id: 'p6', name: 'Fiona', number: 18, gender: 'F' },
  { id: 'p2', name: 'Sarah', number: 23, gender: 'F' },
  { id: 'p9', name: 'Ian', number: 42, gender: 'M' },
  { id: 'p8', name: 'Hannah', number: 88, gender: 'F' },
  { id: 'p4', name: 'Dani', number: 99, gender: 'F' },
];

const PitchMap: React.FC = () => {
  // --- State ---
  const [lineup, setLineup] = useState<Player[]>([]);
  const [currentPossessor, setCurrentPossessor] = useState<Player | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  
  // Game State
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [pointStartTime, setPointStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0); 

  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
  const [dragLocation, setDragLocation] = useState<Coordinate | null>(null);
  const [pendingLocation, setPendingLocation] = useState<Coordinate | null>(null);
  
  // Edit Mode
  const [editingEventId, setEditingEventId] = useState<number | null>(null);

  const [message, setMessage] = useState<string>("Select 7 players to start");
  const svgRef = useRef<SVGSVGElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Derived State (Sorting) ---
  const sortedRoster = useMemo(() => [...TEAM_ROSTER].sort((a, b) => a.number - b.number), [TEAM_ROSTER]);
  const sortedLineup = useMemo(() => [...lineup].sort((a, b) => a.number - b.number), [lineup]);

  // --- Point Stats Calculation (New Memoization) ---
  const pointPlayerStats = useMemo(() => {
    const stats: { [key: string]: { passes: number, goals: number, turns: number, received: number } } = {};

    for (const player of TEAM_ROSTER) {
        stats[player.name] = { passes: 0, goals: 0, turns: 0, received: 0 };
    }

    for (const event of events) {
        // Passes Thrown (Completed throws from a teammate, not Opponent)
        if (event.thrower_name && event.thrower_name !== 'Opponent' && (event.type === 'catch' || event.type === 'goal')) {
            if (stats[event.thrower_name]) {
                stats[event.thrower_name].passes += 1;
            }
        }
        
        // Passes Received (Catches)
        if (event.type === 'catch' || event.type === 'goal') {
             if (stats[event.player_name]) {
                stats[event.player_name].received += 1;
             }
        }

        // Goals
        if (event.type === 'goal') {
            if (stats[event.player_name]) {
                stats[event.player_name].goals += 1;
            }
        }

        // Turns
        if (event.type === 'turnover') {
            if (stats[event.player_name]) {
                stats[event.player_name].turns += 1;
            }
        }
    }
    return stats;
  }, [events]);

  // --- Point Timer ---
  useEffect(() => {
    let interval: any;
    if (pointStartTime && currentPossessor) { 
       interval = setInterval(() => {
         setElapsedTime(Math.floor((Date.now() - pointStartTime) / 1000));
       }, 1000);
    }
    return () => clearInterval(interval);
  }, [pointStartTime, currentPossessor]);

  // --- Point Summary Calculation ---
  const pointStats = useMemo(() => {
     const passes = events.filter(e => e.type === 'catch' || e.type === 'goal');
     const validPasses = passes.filter(e => (e.dist_meters || 0) > 0);
     
     const totalDist = validPasses.reduce((acc, curr) => acc + (curr.dist_meters || 0), 0);
     const avgDist = validPasses.length > 0 ? (totalDist / validPasses.length).toFixed(1) : "0.0";
     
     return {
         count: validPasses.length,
         avg: avgDist,
         total: totalDist.toFixed(0)
     };
  }, [events]);

  // Auto-scroll log
  useEffect(() => {
    if (logContainerRef.current && !editingEventId) {
      logContainerRef.current.scrollTop = 0; 
    }
  }, [events, editingEventId]);

  // --- Helpers (Same as before) ---
  const getCoordinates = (clientX: number, clientY: number): Coordinate => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    return {
      x: (clientX - CTM.e) / CTM.a,
      y: (clientY - CTM.f) / CTM.d
    };
  };

  const calculateDistanceMeters = (p1: Coordinate, p2: Coordinate) => {
    const distUnits = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    return parseFloat((distUnits * YARDS_TO_METERS).toFixed(1));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isEndzone = (y: number) => y <= ENDZONE_DEPTH || y >= FIELD_LENGTH - ENDZONE_DEPTH;
  const getAvatar = (gender: 'M' | 'F') => gender === 'M' ? MALE_AVATAR : FEMALE_AVATAR;
  const getPlayerDetails = (name: string) => TEAM_ROSTER.find(p => p.name === name);

  const getCurrentThrowerLocation = () => {
    if (events.length > 0 && currentPossessor) {
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].player_name === currentPossessor.name) {
                return events[i].location;
            }
        }
    }
    return null;
  };
  const activeThrowerLoc = getCurrentThrowerLocation();

  // --- Handlers (Same as before, only internal logic references updated) ---

  const handleFieldClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editingEventId) return;
    if (lineup.length !== 7) {
      alert("Please select exactly 7 players first.");
      return;
    }
    if (currentPossessor) return; 

    const loc = getCoordinates(e.clientX, e.clientY);
    setPendingLocation(loc);
    setMessage("Who picked up the disc? (Select Player below)");
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (editingEventId) return;
    if (!currentPossessor || !activeThrowerLoc) return;
    setIsDragging(true);
    let clientX, clientY;
    if ('touches' in e) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
    else { clientX = (e as React.MouseEvent).clientX; clientY = (e as React.MouseEvent).clientY; }
    setDragLocation(getCoordinates(clientX, clientY));
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !currentPossessor) return;
    let clientX, clientY;
    if ('touches' in e) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
    else { clientX = (e as React.MouseEvent).clientX; clientY = (e as React.MouseEvent).clientY; }
    setDragLocation(getCoordinates(clientX, clientY));
  };

  const handleMouseUp = () => {
    if (isDragging && dragLocation) {
        setIsDragging(false);
        setPendingLocation(dragLocation);
        setDragLocation(null);
        setMessage("Throw released! Who caught it?");
    }
  };

  const toggleLineup = (player: Player) => {
    if (editingEventId) return; 
    if (lineup.find(p => p.id === player.id)) {
      setLineup(lineup.filter(p => p.id !== player.id));
    } else {
      if (lineup.length < 7) {
         const newLineup = [...lineup, player];
         setLineup(newLineup);
         if (newLineup.length === 7) setMessage("Tap field to set start location (Pull/Turnover)");
      }
      else alert("Max 7 players on field!");
    }
  };

  const handlePlayerSelect = (player: Player) => {
    
    // EDIT MODE LOGIC (Uses updated logic for event propogation)
    if (editingEventId) {
        const index = events.findIndex(e => e.id === editingEventId);
        if (index === -1) return;
        const updatedEvents = [...events];
        const oldPlayerName = updatedEvents[index].player_name;
        updatedEvents[index].player_name = player.name;
        if (index + 1 < updatedEvents.length) {
            if (updatedEvents[index + 1].thrower_name === oldPlayerName) {
                updatedEvents[index + 1].thrower_name = player.name;
            }
        }
        if (index === updatedEvents.length - 1 && updatedEvents[index].type !== 'turnover') {
            setCurrentPossessor(player);
        }
        setEvents(updatedEvents);
        setEditingEventId(null);
        return;
    }

    // PLAY MODE

    // 1. Pickup
    if (!currentPossessor && pendingLocation) {
        setPointStartTime(Date.now()); 
        const newEvent: EventLog = {
            id: Date.now(),
            type: 'catch',
            location: pendingLocation,
            player_name: player.name,
            thrower_name: 'Opponent',
            timestamp: new Date().toISOString(),
            dist_meters: 0,
            pass_number: 0
        };
        setEvents(prev => [...prev, newEvent]);
        setCurrentPossessor(player);
        setPendingLocation(null);
        setMessage(`Possession: ${player.name}. Drag to throw.`);
        return;
    }

    // 2. Pass Completion
    if (currentPossessor && pendingLocation && activeThrowerLoc) {
        if (player.id === currentPossessor.id) return; 

        const isGoal = isEndzone(pendingLocation.y);
        const eventType = isGoal ? 'goal' : 'catch';
        const dist = calculateDistanceMeters(activeThrowerLoc, pendingLocation);
        
        const currentPassCount = events.filter(e => e.type === 'catch' || e.type === 'goal').length;

        const newEvent: EventLog = {
            id: Date.now(),
            type: eventType,
            location: pendingLocation,
            player_name: player.name,
            thrower_name: currentPossessor.name,
            timestamp: new Date().toISOString(),
            dist_meters: dist,
            pass_number: currentPassCount // Pass number starts at 1
        };

        setEvents(prev => [...prev, newEvent]);
        setCurrentPossessor(player);
        setPendingLocation(null);

        if (isGoal) {
            setHomeScore(s => s + 1);
            setMessage(`GOAL! #${currentPossessor.number} -> #${player.number} (${newEvent.dist_meters}m).`);
            setCurrentPossessor(null);
            setPointStartTime(null); 
        } else {
            setMessage(`Possession: ${player.name}`);
        }
    }
  };

  const handleTurnover = () => {
    if (!pendingLocation || !currentPossessor) return;

    const newEvent: EventLog = {
      id: Date.now(),
      type: 'turnover',
      location: pendingLocation,
      player_name: currentPossessor.name,
      timestamp: new Date().toISOString(),
      dist_meters: 0
    };

    setEvents(prev => [...prev, newEvent]);
    setCurrentPossessor(null);
    setPendingLocation(null);
    setPointStartTime(null); 
    setMessage("Turnover! Tap field to set new start.");
  };

  const submitStats = async () => { alert("Stats synced!"); };

  return (
    <div className={`flex flex-col h-screen bg-gray-900 text-white overflow-hidden select-none ${editingEventId ? 'ring-4 ring-amber-500' : ''}`}>
      
      {/* HEADER */}
      <div className={`p-2 shadow-md flex justify-between items-center z-10 shrink-0 border-b border-gray-700 ${editingEventId ? 'bg-amber-900/50' : 'bg-gray-800'}`}>
        <div className="flex-1">
          <p className="text-gray-400 text-xs font-bold uppercase">
             {editingEventId ? <span className="text-amber-400 animate-pulse">⚠ EDITING MODE</span> : "Game Status"}
          </p>
          <p className="text-yellow-400 text-sm font-mono truncate">
            {editingEventId ? "Select the CORRECT player from the list below" : message}
          </p>
        </div>

        {/* Scoreboard controls... (omitted for brevity) */}

        <div className="flex gap-2 flex-1 justify-end">
           {editingEventId ? (
             <button onClick={() => setEditingEventId(null)} className="bg-gray-600 px-4 py-2 rounded flex items-center gap-2 font-bold hover:bg-gray-500">
                <XCircle size={16} /> Cancel
             </button>
           ) : (
             <>
                {pendingLocation && (
                    <button onClick={handleTurnover} className="bg-red-600 px-3 py-1.5 rounded font-bold animate-pulse text-xs">TURN</button>
                )}
                <button onClick={submitStats} className="bg-blue-600 px-3 py-1.5 rounded flex gap-2 items-center text-xs">
                    <Send size={14} /> Send
                </button>
                <button onClick={() => { setEvents([]); setCurrentPossessor(null); setPendingLocation(null); setHomeScore(0); setAwayScore(0); setMessage("Reset Complete"); setPointStartTime(null); setElapsedTime(0); }} className="bg-gray-600 px-3 py-1.5 rounded">
                    <RotateCcw size={14} />
                </button>
             </>
           )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT: Roster (Sorted by Number) */}
        {/* ... Roster rendering logic (omitted for brevity) ... */}

        {/* CENTER: Field */}
        <div className={`flex-1 relative bg-gray-900 flex justify-center overflow-y-auto p-2 touch-none ${editingEventId ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
          
          {/* --- POINT SUMMARY DASHBOARD (HUD) --- */}
          {/* ... HUD rendering logic (omitted for brevity) ... */}

          <svg
            ref={svgRef}
            viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_LENGTH}`}
            className="h-full w-auto max-w-full bg-green-700 cursor-crosshair shadow-2xl border-2 border-white"
            onClick={handleFieldClick}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* ... SVG drawing logic (omitted for brevity) ... */}
          </svg>
        </div>

        {/* RIGHT: Action Log */}
        {/* ... Action Log rendering logic (omitted for brevity) ... */}

      </div>

      {/* BOTTOM BAR: Selection Area */}
      <div className={`bg-gray-800 p-2 border-t border-gray-700 min-h-[100px] shrink-0 overflow-x-auto ${editingEventId ? 'bg-amber-950/30 border-t-2 border-amber-500' : ''}`}>
        
        {editingEventId ? (
             <div className="flex justify-start md:justify-center gap-4 min-w-max px-4">
                <div className="flex flex-col justify-center items-center mr-4 text-amber-500 font-bold text-xs uppercase w-16 text-center">Correct to:</div>
                {sortedLineup.map(player => (
                    <div key={player.id} onClick={() => handlePlayerSelect(player)} className="flex flex-col items-center cursor-pointer active:scale-95 w-16 hover:bg-gray-700/50 rounded p-1">
                        <span className="text-lg font-bold text-gray-200 leading-none mb-1">#{player.number}</span>
                        <img src={getAvatar(player.gender)} alt="" className="w-10 h-10 rounded-full border-2 border-amber-500 bg-gray-700" />
                        <span className="mt-1 text-xs truncate max-w-full font-medium text-amber-200">{player.name}</span>
                    </div>
                ))}
             </div>
        ) : (
            lineup.length < 7 ? (
            <div className="text-center text-gray-400 py-4 flex flex-col items-center">
                <Users className="mb-2" />
                <p className="text-sm">Select 7 players from left roster</p>
            </div>
            ) : (
            <div className="flex justify-start md:justify-center gap-4 min-w-max px-4">
                {/* --- NON-POSSESSOR PICKUP --- */}
                {!currentPossessor && sortedLineup.map(player => {
                    const stats = pointPlayerStats[player.name];
                    return (
                    <div key={player.id} onClick={() => setPendingLocation({x:20, y:100}) || handlePlayerSelect(player)} className="flex flex-col items-center cursor-pointer active:scale-95 w-16 opacity-50 hover:opacity-100 p-1 rounded">
                        <span className="text-lg font-bold text-gray-400 mb-1">#{player.number}</span>
                        <img src={getAvatar(player.gender)} alt="" className="w-10 h-10 rounded-full border-2 border-gray-500 grayscale" />
                        <span className="mt-1 text-xs text-gray-400">{player.name}</span>
                         <div className="flex justify-between w-full text-[10px] text-gray-400 font-mono mt-0.5 px-1">
                            <span>P: {stats.passes}</span>
                            <span>R: {stats.received}</span>
                        </div>
                    </div>
                    );
                })}
                {/* --- RECEIVER SELECTION --- */}
                {currentPossessor && sortedLineup.map(player => {
                    if (currentPossessor.id === player.id) return null;
                    const isClickable = !!pendingLocation;
                    const stats = pointPlayerStats[player.name];

                    return (
                    <div key={player.id} onClick={() => isClickable && handlePlayerSelect(player)} className={`flex flex-col items-center w-16 transition-all duration-200 ${isClickable ? 'cursor-pointer active:scale-95 opacity-100' : 'opacity-30 grayscale'} p-1 rounded`}>
                        <span className="text-lg font-bold text-gray-200 leading-none mb-1">#{player.number}</span>
                        <div className="relative p-1"><img src={getAvatar(player.gender)} alt="" className="w-10 h-10 rounded-full border-2 border-gray-500 bg-gray-700" /></div>
                        
                        <span className={`mt-1 text-xs truncate max-w-full font-medium ${isClickable ? 'text-gray-300' : 'text-gray-400'}`}>
                            {player.name}
                        </span>
                        
                        <div className="flex justify-between w-full text-[10px] text-gray-400 font-mono mt-0.5 px-1">
                            <span className={stats.passes > 0 ? 'text-blue-400' : ''}>P: {stats.passes}</span>
                            <span className={stats.received > 0 ? 'text-green-400' : ''}>R: {stats.received}</span>
                        </div>
                    </div>
                    );
                })}
            </div>
            )
        )}
      </div>
    </div>
  );
};

export default PitchMap;