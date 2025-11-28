import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Send, Users, RotateCcw, ScrollText, Trophy, Pencil, XCircle, Clock, Activity, Hash, Eye, EyeOff } from 'lucide-react';

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

// Storage for hold times: PlayerName -> [durations_in_seconds]
type HoldDurations = { [playerName: string]: number[] };


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
  
  // New State for Hold Time Calculation
  const [possessionAcquisitionTime, setPossessionAcquisitionTime] = useState<number | null>(null);
  const [playerHoldDurations, setPlayerHoldDurations] = useState<HoldDurations>({}); 

  // Game State
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [pointStartTime, setPointStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0); 

  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
  const [dragLocation, setDragLocation] = useState<Coordinate | null>(null);
  const [pendingLocation, setPendingLocation] = useState<Coordinate | null>(null);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  
  // NEW: Toggle for bottom bar stats
  const [showPlayerStats, setShowPlayerStats] = useState(false); 

  const [message, setMessage] = useState<string>("Select 7 players to start");
  const svgRef = useRef<SVGSVGElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Derived State (Sorting) ---
  const sortedRoster = useMemo(() => [...TEAM_ROSTER].sort((a, b) => a.number - b.number), [TEAM_ROSTER]);
  const sortedLineup = useMemo(() => [...lineup].sort((a, b) => a.number - b.number), [lineup]);

  // --- Point Stats Calculation (Includes Avg Hold Time) ---
  const pointPlayerStats = useMemo(() => {
    const stats: { [key: string]: { passes: number, received: number, avg_hold_time: string, total_hold_time: number } } = {};

    for (const player of TEAM_ROSTER) {
        const durations = playerHoldDurations[player.name] || [];
        const totalHold = durations.reduce((sum, duration) => sum + duration, 0);
        const avgHold = durations.length > 0 ? (totalHold / durations.length).toFixed(1) : "0.0";

        stats[player.name] = { 
            passes: 0, 
            received: 0, 
            avg_hold_time: avgHold,
            total_hold_time: totalHold
        };
    }

    for (const event of events) {
        if (event.thrower_name && event.thrower_name !== 'Opponent' && (event.type === 'catch' || event.type === 'goal')) {
            if (stats[event.thrower_name]) {
                stats[event.thrower_name].passes += 1;
            }
        }
        
        if (event.type === 'catch' || event.type === 'goal') {
             if (stats[event.player_name]) {
                stats[event.player_name].received += 1;
             }
        }
    }
    return stats;
  }, [events, playerHoldDurations]);

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

  // --- Helpers ---
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

  // --- LOGIC: Record Hold Time ---
  const recordHoldTime = (thrower: Player) => {
    if (possessionAcquisitionTime) {
        const holdDuration = parseFloat(((Date.now() - possessionAcquisitionTime) / 1000).toFixed(1));
        
        setPlayerHoldDurations(prev => ({
            ...prev,
            [thrower.name]: [...(prev[thrower.name] || []), holdDuration],
        }));
    }
  };

  // --- Handlers ---

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
    
    // EDIT MODE LOGIC 
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
            setPossessionAcquisitionTime(Date.now());
        }
        setEvents(updatedEvents);
        setEditingEventId(null);
        setMessage("Event corrected.");
        return;
    }

    // PLAY MODE

    // 1. Pickup
    if (!currentPossessor && pendingLocation) {
        setPointStartTime(Date.now()); 
        setPossessionAcquisitionTime(Date.now()); // START HOLD TIME
        
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

        // Record hold time for the CURRENT possessor (the thrower)
        recordHoldTime(currentPossessor);
        setPossessionAcquisitionTime(Date.now()); // Receiver starts new hold time

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

    // Record hold time for the CURRENT possessor (the player who turned it over)
    recordHoldTime(currentPossessor);

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
    setPossessionAcquisitionTime(null); // Stop current hold time tracking
    setPointStartTime(null); 
    setMessage("Turnover! Tap field to set new start.");
  };

  const submitStats = async () => { 
     alert("Stats synced!"); 
  };

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
                <button onClick={() => { setEvents([]); setCurrentPossessor(null); setPendingLocation(null); setHomeScore(0); setAwayScore(0); setMessage("Reset Complete"); setPointStartTime(null); setElapsedTime(0); setPlayerHoldDurations({}); }} className="bg-gray-600 px-3 py-1.5 rounded">
                    <RotateCcw size={14} />
                </button>
             </>
           )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT: Roster (Reverted to always show Roster/Lineup Selection) */}
        <div className={`w-20 md:w-56 bg-gray-800 border-r border-gray-700 flex flex-col overflow-y-auto shrink-0 hidden md:flex ${editingEventId ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="p-3 font-bold text-gray-400 uppercase text-xs border-b border-gray-700">Team Roster</div>
          {sortedRoster.map(player => {
            const isSelected = lineup.find(p => p.id === player.id);
            return (
              <div 
                key={player.id}
                onClick={() => toggleLineup(player)}
                className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-700 transition-colors border-b border-gray-700/50 relative ${isSelected ? 'bg-green-900/20' : ''}`}
              >
                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>}
                <img src={getAvatar(player.gender)} alt="" className="w-8 h-8 rounded-full bg-gray-700" />
                <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-center">
                        <p className="font-bold text-sm text-gray-200">#{player.number} {player.name}</p>
                        {isSelected && <span className="text-[10px] font-bold bg-green-600 text-white px-1.5 rounded ml-2 whitespace-nowrap">ON FIELD</span>}
                    </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* CENTER: Field */}
        <div className={`flex-1 relative bg-gray-900 flex justify-center overflow-y-auto p-2 touch-none ${editingEventId ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
          
          {/* --- POINT SUMMARY DASHBOARD (HUD) --- */}
          {!editingEventId && lineup.length === 7 && (
              <div className="absolute top-4 left-4 z-20 bg-gray-900/80 backdrop-blur border border-gray-600 rounded-lg p-2 shadow-xl flex flex-col gap-1 w-32 pointer-events-none select-none">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Clock size={10} /> Time</span>
                      <span className="font-mono text-white">{formatTime(elapsedTime)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Hash size={10} /> Passes</span>
                      <span className="font-mono text-white">{pointStats.count}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Activity size={10} /> Avg Dist</span>
                      <span className="font-mono text-green-400">{pointStats.avg}m</span>
                  </div>
              </div>
          )}

          <svg
            ref={svgRef}
            viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_LENGTH}`}
            className="h-full w-auto max-w-full bg-green-700 cursor-crosshair shadow-2xl border-2 border-white"
            onClick={handleFieldClick}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Markings */}
            <rect x="0" y="0" width={FIELD_WIDTH} height={ENDZONE_DEPTH} fill="rgba(255,255,255,0.15)" />
            <line x1="0" y1={ENDZONE_DEPTH} x2={FIELD_WIDTH} y2={ENDZONE_DEPTH} stroke="white" strokeWidth="0.5" />
            <rect x="0" y={FIELD_LENGTH - ENDZONE_DEPTH} width={FIELD_WIDTH} height={ENDZONE_DEPTH} fill="rgba(255,255,255,0.15)" />
            <line x1="0" y1={FIELD_LENGTH - ENDZONE_DEPTH} x2={FIELD_WIDTH} y2={FIELD_LENGTH - ENDZONE_DEPTH} stroke="white" strokeWidth="0.5" />
            
            {/* Links & Players */}
            {events.map((evt, i) => {
              if (i === 0 || evt.type === 'turnover') return null;
              const prev = events[i - 1];
              if (!prev) return null;
              return <line key={`l-${evt.id}`} x1={prev.location.x} y1={prev.location.y} x2={evt.location.x} y2={evt.location.y} stroke="rgba(255,255,255,0.4)" strokeWidth="0.3" strokeDasharray="1,0.5" />;
            })}
            {events.map((evt) => {
               const p = getPlayerDetails(evt.player_name);
               const isCur = currentPossessor?.name === evt.player_name && events[events.length-1].id === evt.id;
               const size = 3;
               return (
                <g key={evt.id} opacity={isCur ? 1 : 0.6}>
                  <image href={p ? getAvatar(p.gender) : ""} x={evt.location.x - size/2} y={evt.location.y - size/2} height={size} width={size} className="rounded-full" />
                  <circle cx={evt.location.x} cy={evt.location.y} r={size/2} fill="none" stroke={evt.type === 'goal' ? 'gold' : 'white'} strokeWidth="0.2" />
                  <rect x={evt.location.x - 1.5} y={evt.location.y - size + 0.5} width="3" height="1.5" rx="0.5" fill="rgba(0,0,0,0.8)" />
                  <text x={evt.location.x} y={evt.location.y - size + 1.5} fontSize="1" fill="white" textAnchor="middle" fontWeight="bold">#{p?.number}</text>
                  {isCur && <circle cx={evt.location.x} cy={evt.location.y} r={size/2 + 0.5} stroke="yellow" strokeWidth="0.3" fill="none"><animate attributeName="stroke-width" values="0.1;0.5;0.1" dur="1.5s" repeatCount="indefinite" /></circle>}
                </g>
              );
            })}
            
            {/* Drag Line */}
            {isDragging && activeThrowerLoc && dragLocation && (
                <line x1={activeThrowerLoc.x} y1={activeThrowerLoc.y} x2={dragLocation.x} y2={dragLocation.y} stroke="yellow" strokeWidth="0.5" strokeDasharray="0.5,0.5" />
            )}
            
            {/* Target */}
            {pendingLocation && (
                <g>
                    {currentPossessor && activeThrowerLoc && <line x1={activeThrowerLoc.x} y1={activeThrowerLoc.y} x2={pendingLocation.x} y2={pendingLocation.y} stroke="yellow" strokeWidth="0.5" strokeDasharray="1,1" opacity="0.8" />}
                    <circle cx={pendingLocation.x} cy={pendingLocation.y} r="1.5" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="0.2" strokeDasharray="0.2,0.2" />
                    <circle cx={pendingLocation.x} cy={pendingLocation.y} r="2" stroke="white" strokeWidth="0.1" fill="none"><animate attributeName="r" values="1.5;2.5" dur="1s" repeatCount="indefinite" /><animate attributeName="opacity" values="1;0" dur="1s" repeatCount="indefinite" /></circle>
                </g>
            )}
          </svg>
        </div>

        {/* RIGHT: Action Log */}
        <div className={`w-36 md:w-64 bg-gray-800 border-l border-gray-700 flex flex-col shrink-0 ${editingEventId ? 'border-amber-500 border-l-4' : ''}`}>
            <div className="p-3 font-bold text-gray-400 uppercase text-xs border-b border-gray-700 flex items-center gap-2">
                <ScrollText size={14} /> Action Log
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 flex flex-col-reverse" ref={logContainerRef}>
                {events.length === 0 && <p className="text-gray-500 text-xs italic text-center mt-4">No events yet.</p>}
                
                {events.map((evt) => {
                    const p = getPlayerDetails(evt.player_name);
                    const thrower = evt.thrower_name ? getPlayerDetails(evt.thrower_name) : null;
                    const isEditingThis = editingEventId === evt.id;

                    let bgClass = "bg-gray-700/50 border-gray-600";
                    let icon = <Send size={12} className="text-blue-400" />;
                    let text = "";
                    let subtext = "";

                    if (evt.type === 'catch') {
                        if (thrower) {
                            text = `${thrower.name} ➝ ${p?.name}`;
                            subtext = `Pass #${evt.pass_number} • ${evt.dist_meters}m`;
                        } else {
                            text = `${p?.name} (Pickup)`;
                        }
                    } else if (evt.type === 'goal') {
                        bgClass = "bg-yellow-900/30 border-yellow-600";
                        icon = <Trophy size={12} className="text-yellow-400" />;
                        text = `GOAL! ${thrower?.name} ➝ ${p?.name}`;
                        subtext = `Pass #${evt.pass_number} • ${evt.dist_meters}m`;
                    } else if (evt.type === 'turnover') {
                        bgClass = "bg-red-900/30 border-red-600";
                        text = `Turnover (${p?.name})`;
                    }

                    if (isEditingThis) bgClass = "bg-amber-900/60 border-amber-400 border-2";

                    return (
                        <div key={evt.id} className={`p-2 rounded border text-xs relative group ${bgClass}`}>
                            <div className="flex items-center gap-2 mb-1 justify-between">
                                <div className="flex items-center gap-2">
                                    {icon}
                                    <span className="text-gray-400 font-mono text-[10px]">{evt.timestamp.split('T')[1].slice(0,5)}</span>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setEditingEventId(evt.id); }} className="text-gray-400 hover:text-white hover:bg-gray-600 p-1 rounded" title="Edit Player"><Pencil size={10} /></button>
                            </div>
                            <div className="font-medium text-gray-200">{text}</div>
                            {subtext && <div className="text-[10px] text-gray-400 mt-0.5">{subtext}</div>}
                        </div>
                    );
                })}
            </div>
        </div>
      </div>

      {/* BOTTOM BAR: Selection Area + Show Stats Toggle */}
      <div className={`bg-gray-800 p-2 border-t border-gray-700 min-h-[100px] shrink-0 overflow-x-auto ${editingEventId ? 'bg-amber-950/30 border-t-2 border-amber-500' : ''}`}>
        
        {lineup.length === 7 && (
            <div className="flex justify-end p-2 md:p-0">
                <button 
                    onClick={() => setShowPlayerStats(s => !s)}
                    className="bg-gray-600 hover:bg-gray-500 text-xs text-white px-3 py-1 rounded flex items-center gap-1.5 transition-colors"
                >
                    {showPlayerStats ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showPlayerStats ? "Hide Stats" : "Show Stats"}
                </button>
            </div>
        )}

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
                {sortedLineup.map(player => {
                    const isPossessor = currentPossessor?.id === player.id;
                    if (!currentPossessor && isPossessor) return null;
                    if (currentPossessor && isPossessor && pendingLocation) return null; 

                    const isClickable = !!pendingLocation || !currentPossessor;
                    const stats = pointPlayerStats[player.name] || { passes: 0, received: 0, avg_hold_time: '0.0' };
                    
                    const handleClick = () => {
                        if (!currentPossessor && !pendingLocation) {
                            setPendingLocation({x:20, y:100}); 
                            handlePlayerSelect(player);
                        } else if (isClickable) {
                            handlePlayerSelect(player);
                        }
                    };
                    
                    const borderClass = isClickable ? 'border-gray-500' : 'border-gray-800';

                    return (
                    <div key={player.id} onClick={handleClick} className={`flex flex-col items-center cursor-pointer active:scale-95 w-16 transition-all duration-200 ${isClickable ? 'opacity-100' : 'opacity-30 grayscale'} p-1 rounded`}>
                        <span className="text-lg font-bold text-gray-200 leading-none mb-1">#{player.number}</span>
                        <div className="relative p-1">
                            <img src={getAvatar(player.gender)} alt="" className={`w-10 h-10 rounded-full border-2 ${borderClass} bg-gray-700`} />
                        </div>
                        
                        <span className={`mt-1 text-xs truncate max-w-full font-medium ${isClickable ? 'text-gray-300' : 'text-gray-400'}`}>
                            {player.name}
                        </span>
                        
                        {/* CONDITIONAL STATS DISPLAY */}
                        {showPlayerStats && (
                            <div className="flex flex-col w-full text-[9px] text-gray-400 font-mono mt-0.5 px-1 font-bold bg-gray-700/50 rounded p-1">
                                <span className="flex justify-between">P: <span className={stats.passes > 0 ? 'text-blue-400' : 'text-gray-300'}>{stats.passes}</span></span>
                                <span className="flex justify-between">R: <span className={stats.received > 0 ? 'text-green-400' : 'text-gray-300'}>{stats.received}</span></span>
                                <span className="flex justify-between">H: <span className={stats.avg_hold_time !== '0.0' ? 'text-yellow-400' : 'text-gray-300'}>{stats.avg_hold_time}s</span></span>
                            </div>
                        )}
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