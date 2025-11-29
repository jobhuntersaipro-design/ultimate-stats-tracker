import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Send, Users, RotateCcw, ScrollText, Trophy, Pencil, XCircle, Clock, Activity, Hash, Eye, EyeOff, SkipForward, Ban, CheckCircle, AlertTriangle, Hand, Network, Shield, ShieldAlert } from 'lucide-react';

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
  type: 'pull' | 'catch' | 'turnover' | 'goal' | 'block' | 'opponent_turn' | 'opponent_score'; // Added defensive types
  phase: 'offense' | 'defense'; // NEW: Track phase
  location: Coordinate;
  player_name: string; 
  thrower_name?: string; 
  intended_receiver_name?: string; 
  timestamp: string;
  dist_meters?: number;
  pass_number?: number;
  error_type?: 'throw' | 'receive'; 
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
  
  // NEW: Track Phase
  const [currentPhase, setCurrentPhase] = useState<'offense' | 'defense'>('offense');

  // Current Point Events
  const [events, setEvents] = useState<EventLog[]>([]);
  const [matchHistory, setMatchHistory] = useState<EventLog[][]>([]);
  
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
  
  // UI Toggles
  const [showPlayerStats, setShowPlayerStats] = useState(false); 
  const [showNextPointPrompt, setShowNextPointPrompt] = useState(false);
  const [showMatchEndConfirm, setShowMatchEndConfirm] = useState(false);
  const [isMatchFinished, setIsMatchFinished] = useState(false);

  // Turnover Interaction States
  const [showTurnoverTypePrompt, setShowTurnoverTypePrompt] = useState(false);
  const [isSelectingDropper, setIsSelectingDropper] = useState(false);
  const [isSelectingIntended, setIsSelectingIntended] = useState(false); 

  const [message, setMessage] = useState<string>("Select 7 players to start");
  const svgRef = useRef<SVGSVGElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Derived State (Sorting) ---
  const sortedRoster = useMemo(() => [...TEAM_ROSTER].sort((a, b) => a.number - b.number), [TEAM_ROSTER]);
  const sortedLineup = useMemo(() => [...lineup].sort((a, b) => a.number - b.number), [lineup]);

  // --- Helpers ---
  const getAvatar = (gender: 'M' | 'F') => gender === 'M' ? MALE_AVATAR : FEMALE_AVATAR;
  const getPlayerDetails = (name: string) => TEAM_ROSTER.find(p => p.name === name);
  const getPlayerDisplay = (name: string | undefined) => {
    if (!name || name === 'Opponent') return name;
    const p = getPlayerDetails(name);
    return p ? `${p.name} (#${p.number})` : name;
  };

  // --- Stats Calculation Engine ---
  const calculateStats = (eventList: EventLog[], holdData: HoldDurations) => {
    const stats: { 
        [key: string]: { 
            passes: number, received: number, assists: number, scores: number, turnovers: number,
            throw_errors: number, drop_errors: number, blocks: number, // NEW: blocks
            avg_hold_time: string, total_hold_time: number,
            total_dist: number, avg_dist: string,
            turnover_dist: number
        } 
    } = {};

    const connections: { 
        [key: string]: { 
            pair: string, completions: number, drops: number, throw_errors: number 
        } 
    } = {};

    const getConnKey = (p1: string, p2: string) => `${p1}-${p2}`;
    const updateConn = (thrower: string, receiver: string, type: 'complete' | 'drop' | 'throw_err') => {
        const key = getConnKey(thrower, receiver);
        if (!connections[key]) connections[key] = { pair: `${thrower} ➝ ${receiver}`, completions: 0, drops: 0, throw_errors: 0 };
        if (type === 'complete') connections[key].completions++;
        if (type === 'drop') connections[key].drops++;
        if (type === 'throw_err') connections[key].throw_errors++;
    };

    // Initialize Stats
    for (const player of TEAM_ROSTER) {
        const durations = holdData[player.name] || [];
        const totalHold = durations.reduce((sum, duration) => sum + duration, 0);
        const avgHold = durations.length > 0 ? (totalHold / durations.length).toFixed(1) : "0.0";

        stats[player.name] = { 
            passes: 0, received: 0, assists: 0, scores: 0, turnovers: 0,
            throw_errors: 0, drop_errors: 0, blocks: 0,
            avg_hold_time: avgHold, total_hold_time: totalHold,
            total_dist: 0, avg_dist: "0.0", turnover_dist: 0
        };
    }

    for (const event of eventList) {
        // Distance Logic
        if (event.dist_meters && event.dist_meters > 0) {
            if (event.type === 'catch' || event.type === 'goal') {
                if (stats[event.player_name]) stats[event.player_name].total_dist += event.dist_meters;
                if (event.thrower_name && event.thrower_name !== 'Opponent' && stats[event.thrower_name]) {
                    stats[event.thrower_name].total_dist += event.dist_meters;
                }
            }
            if (event.type === 'turnover') {
                 const throwerName = event.thrower_name || event.player_name; 
                 if (throwerName !== 'Opponent' && stats[throwerName]) {
                     stats[throwerName].turnover_dist += event.dist_meters;
                 }
            }
        }

        // Connection Logic & Basic Counts
        if ((event.type === 'goal' || event.type === 'catch') && event.thrower_name && event.thrower_name !== 'Opponent') {
            updateConn(event.thrower_name, event.player_name, 'complete');
        }

        if (event.type === 'goal') {
             if (event.thrower_name && event.thrower_name !== 'Opponent' && stats[event.thrower_name]) stats[event.thrower_name].assists += 1;
             if (stats[event.player_name]) stats[event.player_name].scores += 1;
        }
        if (event.type === 'catch') {
             if (event.thrower_name && event.thrower_name !== 'Opponent' && stats[event.thrower_name]) stats[event.thrower_name].passes += 1;
             if (stats[event.player_name]) stats[event.player_name].received += 1;
        }
        
        // Block Logic (NEW)
        if (event.type === 'block') {
            if (stats[event.player_name]) stats[event.player_name].blocks += 1;
        }

        // Turnover Logic
        if (event.type === 'turnover') {
            if (event.error_type === 'throw') {
                if (stats[event.player_name]) {
                    stats[event.player_name].turnovers += 1;
                    stats[event.player_name].throw_errors += 1;
                }
                if (event.intended_receiver_name) {
                    updateConn(event.player_name, event.intended_receiver_name, 'throw_err');
                }
            } else if (event.error_type === 'receive') {
                 if (stats[event.player_name]) {
                    stats[event.player_name].turnovers += 1;
                    stats[event.player_name].drop_errors += 1;
                 }
                 if (event.thrower_name && event.thrower_name !== 'Opponent') {
                     updateConn(event.thrower_name, event.player_name, 'drop');
                 }
            } else {
                if (stats[event.player_name]) stats[event.player_name].turnovers += 1;
            }
        }
    }

    for (const playerName in stats) {
        const s = stats[playerName];
        const totalTouches = (s.passes + s.assists) + (s.received + s.scores);
        if (totalTouches > 0) s.avg_dist = (s.total_dist / totalTouches).toFixed(1);
    }
    
    const sortedConnections = Object.values(connections).sort((a,b) => (b.completions + b.drops + b.throw_errors) - (a.completions + a.drops + a.throw_errors));

    return { playerStats: stats, connectionStats: sortedConnections };
  };

  const pointData = useMemo(() => calculateStats(events, playerHoldDurations), [events, playerHoldDurations]);
  const matchData = useMemo(() => {
      const allEvents = [...matchHistory.flat(), ...events];
      return calculateStats(allEvents, playerHoldDurations);
  }, [matchHistory, events, playerHoldDurations]);


  // --- Point Timer ---
  useEffect(() => {
    let interval: any;
    const isPaused = showNextPointPrompt || isMatchFinished || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended;
    // Count time in both offense and defense (it's game time)
    if (pointStartTime && !isPaused) { 
       interval = setInterval(() => {
         setElapsedTime(Math.floor((Date.now() - pointStartTime) / 1000));
       }, 1000);
    }
    return () => clearInterval(interval);
  }, [pointStartTime, showNextPointPrompt, isMatchFinished, showTurnoverTypePrompt, isSelectingDropper, isSelectingIntended]);

  // --- Point Summary ---
  const pointStats = useMemo(() => {
     const passes = events.filter(e => e.type === 'catch' || e.type === 'goal');
     const validPasses = passes.filter(e => (e.dist_meters || 0) > 0);
     const totalDist = validPasses.reduce((acc, curr) => acc + (curr.dist_meters || 0), 0);
     const avgDist = validPasses.length > 0 ? (totalDist / validPasses.length).toFixed(1) : "0.0";
     return { count: validPasses.length, avg: avgDist, total: totalDist.toFixed(0) };
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

  const recordHoldTime = (thrower: Player) => {
    if (possessionAcquisitionTime) {
        const holdDuration = parseFloat(((Date.now() - possessionAcquisitionTime) / 1000).toFixed(1));
        setPlayerHoldDurations(prev => ({
            ...prev,
            [thrower.name]: [...(prev[thrower.name] || []), holdDuration],
        }));
    }
  };
  
  // --- MATCH & POINT FLOW ---

  const handleNextPoint = () => {
      setMatchHistory(prev => [...prev, events]); 
      setEvents([]);
      setCurrentPossessor(null);
      setPendingLocation(null);
      setPointStartTime(null); 
      setElapsedTime(0);
      setCurrentPhase('offense'); // Default start
      setShowNextPointPrompt(false);
      setMessage("Start next point. Tap field for pull/pickup.");
  };

  const requestMatchEnd = () => {
      setShowNextPointPrompt(false);
      setShowMatchEndConfirm(true);
  };

  const confirmMatchEnd = () => {
      setMatchHistory(prev => [...prev, events]); 
      setShowMatchEndConfirm(false);
      setIsMatchFinished(true);
      setMessage("Match Ended. Viewing Statistics.");
  };

  const cancelMatchEnd = () => {
      setShowMatchEndConfirm(false);
      setShowNextPointPrompt(true); 
  };

  const resetMatch = () => {
      setEvents([]);
      setMatchHistory([]);
      setHomeScore(0); setAwayScore(0);
      setPlayerHoldDurations({});
      setCurrentPossessor(null); setPendingLocation(null);
      setPointStartTime(null); setElapsedTime(0);
      setCurrentPhase('offense');
      setShowNextPointPrompt(false);
      setIsMatchFinished(false);
      setMessage("New Match Started");
  };

  // --- DEFENSE & TURNOVER LOGIC ---

  const initiateTurnoverSequence = () => {
      // Allow Dropped Pull (No possessor, start of point)
      if (!currentPossessor && events.length === 0 && pendingLocation) {
          setIsSelectingDropper(true);
          setMessage("Dropped Pull: Select who dropped it.");
          return;
      }
      
      if (!currentPossessor) return;
      setShowTurnoverTypePrompt(true);
  };

  const handleTurnoverSelection = (type: 'throw' | 'receive') => {
      setShowTurnoverTypePrompt(false);
      
      if (type === 'throw') {
          setIsSelectingIntended(true);
          setMessage("Throw Error: Select the INTENDED receiver (or tap field if none).");
      } else {
          setIsSelectingDropper(true);
          setMessage("Receive Error: Select the player who DROPPED it.");
      }
  };

  const handleNoIntendedReceiver = () => {
      if (isSelectingIntended && currentPossessor) {
          executeTurnover(currentPossessor, 'throw', null); 
      }
  };

  const executeTurnover = (blamedPlayer: Player, type: 'throw' | 'receive', intendedReceiver: Player | null) => {
    if (!pendingLocation) return; 

    if (currentPossessor) {
        recordHoldTime(currentPossessor);
    }
    
    const dist = activeThrowerLoc ? calculateDistanceMeters(activeThrowerLoc, pendingLocation) : 0;
    
    const isDroppedPull = !currentPossessor && events.length === 0;
    let throwerNameVal = undefined;

    if (type === 'receive') {
        throwerNameVal = isDroppedPull ? 'Opponent' : currentPossessor?.name;
    }

    const newEvent: EventLog = {
      id: Date.now(),
      type: 'turnover',
      phase: 'offense', // The turnover ENDS the offensive phase, but technically belongs to it
      location: pendingLocation,
      player_name: blamedPlayer.name, 
      thrower_name: throwerNameVal, 
      intended_receiver_name: intendedReceiver ? intendedReceiver.name : undefined, 
      timestamp: new Date().toISOString(),
      dist_meters: dist,
      error_type: type
    };

    setEvents(prev => [...prev, newEvent]);
    setCurrentPossessor(null);
    setPendingLocation(null);
    setPossessionAcquisitionTime(null); 
    setPointStartTime(null); 
    
    // SWITCH TO DEFENSE
    setCurrentPhase('defense');
    
    setIsSelectingDropper(false);
    setIsSelectingIntended(false);
    setMessage("DEFENSE! Tap Player for Block (D) or Field for Opponent Turn.");
  };

  const handleOpponentScore = () => {
      if (window.confirm("Confirm Opponent Scored?")) {
        setAwayScore(s => s + 1);
        const newEvent: EventLog = {
            id: Date.now(),
            type: 'opponent_score',
            phase: 'defense',
            location: {x: FIELD_WIDTH/2, y: isEndzone(0) ? 0 : FIELD_LENGTH}, // Generic location
            player_name: 'Opponent',
            timestamp: new Date().toISOString()
        };
        setEvents(prev => [...prev, newEvent]);
        setPointStartTime(null);
        setShowNextPointPrompt(true);
        setMessage("Opponent Scored. Point Over.");
      }
  };


  // --- Handlers ---

  const handleFieldClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isSelectingIntended) {
        handleNoIntendedReceiver();
        return;
    }

    if (editingEventId || showNextPointPrompt || showMatchEndConfirm || isMatchFinished || showTurnoverTypePrompt || isSelectingDropper) return;
    if (lineup.length !== 7) { alert("Please select exactly 7 players first."); return; }
    
    const loc = getCoordinates(e.clientX, e.clientY);
    
    // DEFENSE MODE: Clicking field means Opponent Turnover (We get it back)
    if (currentPhase === 'defense') {
        const newEvent: EventLog = {
            id: Date.now(),
            type: 'opponent_turn',
            phase: 'defense',
            location: loc,
            player_name: 'Opponent',
            timestamp: new Date().toISOString()
        };
        setEvents(prev => [...prev, newEvent]);
        setCurrentPhase('offense');
        setPendingLocation(loc); // Disc is here now
        setMessage("Opponent Turnover! Who picks it up?");
        return;
    }

    if (currentPossessor) return; 

    setPendingLocation(loc);
    setMessage("Who picked up the disc? (Select Player below)");
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (editingEventId || showNextPointPrompt || showMatchEndConfirm || isMatchFinished || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended) return;
    if (!currentPossessor || !activeThrowerLoc) return;
    setIsDragging(true);
    let clientX, clientY;
    if ('touches' in e) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
    else { clientX = (e as React.MouseEvent).clientX; clientY = (e as React.MouseEvent).clientY; }
    setDragLocation(getCoordinates(clientX, clientY));
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !currentPossessor || showNextPointPrompt || showMatchEndConfirm || isMatchFinished || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended) return;
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
    if (editingEventId || showNextPointPrompt || showMatchEndConfirm || isMatchFinished || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended) return; 
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
    if (editingEventId || showNextPointPrompt || showMatchEndConfirm || isMatchFinished || showTurnoverTypePrompt) return; 

    // --- SELECTION MODES ---
    if (isSelectingDropper) {
        if (currentPossessor && player.id === currentPossessor.id) return;
        executeTurnover(player, 'receive', null);
        return;
    }
    if (isSelectingIntended) {
        if (currentPossessor && player.id === currentPossessor.id) return;
        if (currentPossessor) executeTurnover(currentPossessor, 'throw', player); 
        return;
    }

    // --- DEFENSE MODE: BLOCK (D) ---
    if (currentPhase === 'defense') {
        const newEvent: EventLog = {
            id: Date.now(),
            type: 'block',
            phase: 'defense',
            location: { x: 20, y: 55 }, // Generic location for block, or could use prev pending? Keeping simple.
            player_name: player.name,
            timestamp: new Date().toISOString()
        };
        setEvents(prev => [...prev, newEvent]);
        setCurrentPhase('offense');
        // Player gets disc immediately
        setPendingLocation({ x: 20, y: 55 }); // Center field default or need click? 
        // Better UX: Block implies possession usually, or pickup. Let's say block -> pickup needed.
        // Actually, let's make Block = We have disc, need to set location.
        setPendingLocation(null);
        setCurrentPossessor(player); // Simplification: Blocker picks it up? Or just turnover?
        // Let's do: Block -> Turnover -> Pick up. 
        // Revert: Block means they knocked it down. They might not have caught it.
        // Let's just switch to offense and ask for location.
        setCurrentPossessor(null);
        setPendingLocation(null);
        setMessage(`${player.name} got a Block! Tap field to set disc location.`);
        return;
    }

    // EDIT MODE LOGIC 
    if (editingEventId) {
        const index = events.findIndex(e => e.id === editingEventId);
        if (index === -1) return;
        const updatedEvents = [...events];
        updatedEvents[index].player_name = player.name;
        setEvents(updatedEvents);
        setEditingEventId(null);
        return;
    }

    // PLAY MODE
    if (currentPossessor && player.id === currentPossessor.id) {
        if (pendingLocation) {
            setCurrentPossessor(currentPossessor);
            setPendingLocation(null);
            setMessage(`Throw cancelled. Disc still with ${currentPossessor.name}. Drag to throw.`);
            return;
        }
    }

    // 1. Pickup
    if (!currentPossessor && pendingLocation) {
        if (!pointStartTime) setPointStartTime(Date.now()); 
        setPossessionAcquisitionTime(Date.now()); 
        const newEvent: EventLog = { id: Date.now(), type: 'catch', phase: 'offense', location: pendingLocation, player_name: player.name, thrower_name: 'Opponent', timestamp: new Date().toISOString(), dist_meters: 0, pass_number: 0 };
        setEvents(prev => [...prev, newEvent]);
        setCurrentPossessor(player);
        setPendingLocation(null);
        setMessage(`Possession: ${player.name}. Drag to throw.`);
        return;
    }

    // 2. Pass Completion
    if (currentPossessor && pendingLocation && activeThrowerLoc) {
        if (player.id === currentPossessor.id) return; 

        recordHoldTime(currentPossessor);
        setPossessionAcquisitionTime(Date.now()); 

        const isGoal = isEndzone(pendingLocation.y);
        const eventType = isGoal ? 'goal' : 'catch';
        const dist = calculateDistanceMeters(activeThrowerLoc, pendingLocation);
        const currentPassCount = events.filter(e => e.type === 'catch' || e.type === 'goal').length;

        const newEvent: EventLog = {
            id: Date.now(),
            type: eventType,
            phase: 'offense',
            location: pendingLocation,
            player_name: player.name,
            thrower_name: currentPossessor.name,
            timestamp: new Date().toISOString(),
            dist_meters: dist,
            pass_number: currentPassCount
        };

        setEvents(prev => [...prev, newEvent]);
        setCurrentPossessor(player);
        setPendingLocation(null);

        if (isGoal) {
            setHomeScore(s => s + 1);
            setMessage(`GOAL! ${getPlayerDisplay(currentPossessor.name)} -> ${getPlayerDisplay(player.name)} (${newEvent.dist_meters}m).`);
            setCurrentPossessor(null);
            setPointStartTime(null); 
            setShowNextPointPrompt(true);
        } else {
            setMessage(`Possession: ${player.name}`);
        }
    }
  };

  const submitStats = async () => { alert("Stats synced!"); };

  // --- Card Helper ---
  const getCardClasses = (player: Player, isClickable: boolean, isPossessor: boolean) => {
      let base = "w-24 h-[120px] rounded-lg shadow-xl p-1 flex flex-col justify-start items-center transition-all duration-150 relative overflow-hidden text-white cursor-pointer select-none";
      let background = "bg-gray-700/70 border border-gray-600";
      let status = "";
      
      const isThrowerInSelectionMode = (isSelectingDropper || isSelectingIntended) && currentPossessor?.id === player.id;

      if (currentPhase === 'defense') {
          // Defense styling
          status = "hover:bg-blue-900/50 hover:ring-2 ring-blue-400 bg-gray-800/70 cursor-pointer";
          background = "bg-red-900/20 border-red-800"; // Slight red tint for defense
      } else if (isThrowerInSelectionMode) {
          status = "opacity-20 grayscale cursor-not-allowed border-red-900";
      } else if (isSelectingDropper) {
          status = "hover:bg-red-900/50 hover:ring-2 ring-red-400 bg-gray-800/70 cursor-crosshair";
      } else if (isSelectingIntended) {
          status = "hover:bg-amber-900/50 hover:ring-2 ring-amber-400 bg-gray-800/70 cursor-crosshair animate-pulse";
      } else if (isPossessor) {
          status = "ring-2 ring-yellow-400 shadow-[0_0_10px_#facc15] bg-yellow-900/40";
      } else if (isClickable) {
          status = "hover:bg-blue-900/50 hover:ring-2 ring-blue-400 bg-gray-800/70";
      } else {
          status = "opacity-30 grayscale pointer-events-none";
      }

      return `${base} ${background} ${status}`;
  }

  // --- Render Log Helper ---
  const renderActionLog = () => {
    let lastPhase = '';
    let phaseCount = 1; // Basic possession counter logic could go here

    // We need to render in reverse order for the UI, but grouping requires knowing the order.
    // Let's iterate forward to build groups, then render groups in reverse.
    // Actually, simple visual separators based on prev index is easier.
    
    return events.slice().reverse().map((evt, index, arr) => {
         const p = getPlayerDetails(evt.player_name);
         const thrower = evt.thrower_name ? getPlayerDetails(evt.thrower_name) : null;
         const isEditingThis = editingEventId === evt.id;
         let bgClass = "bg-gray-700/50 border-gray-600";
         let icon = <Send size={12} className="text-blue-400" />;
         let text = ""; let subtext = "";
         const receiverDisplay = getPlayerDisplay(p?.name);
         const throwerDisplay = getPlayerDisplay(thrower?.name);

         // Phase Header
         let phaseHeader = null;
         // Check if the NEXT event (chronologically previous) had a different phase
         const nextEvt = arr[index + 1];
         if (!nextEvt || nextEvt.phase !== evt.phase) {
             const isDef = evt.phase === 'defense';
             phaseHeader = (
                 <div className={`text-[10px] font-bold uppercase tracking-widest text-center py-1 mt-2 mb-1 rounded ${isDef ? 'bg-red-900/50 text-red-200' : 'bg-green-900/50 text-green-200'}`}>
                     {isDef ? '▲ Defense' : '▼ Offense'}
                 </div>
             );
         }

         if (evt.type === 'catch') {
             if (thrower) { text = `${throwerDisplay} ➝ ${receiverDisplay}`; subtext = `Pass #${evt.pass_number} • ${evt.dist_meters}m`; } 
             else { text = `${receiverDisplay} (Pickup)`; }
         } else if (evt.type === 'goal') {
             bgClass = "bg-yellow-900/30 border-yellow-600"; icon = <Trophy size={12} className="text-yellow-400" />;
             text = `GOAL! ${throwerDisplay} ➝ ${receiverDisplay}`; subtext = `Assist (${throwerDisplay}) • Score (${receiverDisplay})`;
         } else if (evt.type === 'turnover') {
             bgClass = "bg-red-900/30 border-red-600"; 
             if (evt.thrower_name === 'Opponent') {
                 text = `Dropped Pull (${receiverDisplay})`;
             } else if (evt.error_type === 'receive' && evt.thrower_name) {
                  text = `${throwerDisplay} ➝ ${receiverDisplay} (Drop)`;
             } else if (evt.error_type === 'throw' && evt.intended_receiver_name) {
                  text = `${getPlayerDisplay(evt.player_name)} ➝ ${getPlayerDisplay(evt.intended_receiver_name)} (Throw Err)`;
             } else {
                  const typeText = evt.error_type === 'throw' ? 'Throw Err' : 'Turnover';
                  text = `${typeText} (${receiverDisplay})`;
             }
         } else if (evt.type === 'block') {
             bgClass = "bg-blue-900/30 border-blue-500"; icon = <Shield size={12} className="text-blue-400" />;
             text = `BLOCK (D) by ${receiverDisplay}`;
         } else if (evt.type === 'opponent_turn') {
             bgClass = "bg-green-900/30 border-green-500"; icon = <RotateCcw size={12} className="text-green-400" />;
             text = "Opponent Turnover";
         } else if (evt.type === 'opponent_score') {
             bgClass = "bg-red-950 border-red-600"; icon = <Ban size={12} className="text-red-500" />;
             text = "Opponent Goal";
         }
         
         if (isEditingThis) bgClass = "bg-amber-900/60 border-amber-400 border-2";

         return (
             <React.Fragment key={evt.id}>
                 <div className={`p-2 rounded border text-xs relative group ${bgClass}`}>
                     <div className="flex items-center gap-2 mb-1 justify-between">
                         <div className="flex items-center gap-2">{icon}<span className="text-gray-400 font-mono text-[10px]">{evt.timestamp.split('T')[1].slice(0,5)}</span></div>
                         {evt.type !== 'opponent_score' && <button onClick={(e) => { e.stopPropagation(); setEditingEventId(evt.id); }} className="text-gray-400 hover:text-white hover:bg-gray-600 p-1 rounded" title="Edit Player"><Pencil size={10} /></button>}
                     </div>
                     <div className="font-medium text-gray-200">{text}</div>
                     {subtext && <div className="text-[10px] text-gray-400 mt-0.5">{subtext}</div>}
                 </div>
                 {phaseHeader}
             </React.Fragment>
         );
    });
  }

  return (
    <div className={`flex flex-col h-screen bg-gray-900 text-white overflow-hidden select-none ${editingEventId ? 'ring-4 ring-amber-500' : ''}`}>
      
      {/* HEADER */}
      <div className={`p-2 shadow-md flex justify-between items-center z-10 shrink-0 border-b border-gray-700 relative ${editingEventId ? 'bg-amber-900/50' : 'bg-gray-800'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-gray-400 text-xs font-bold uppercase flex items-center gap-2">
             {editingEventId ? <span className="text-amber-400 animate-pulse">⚠ EDITING MODE</span> : "Game Status"}
             {currentPhase === 'defense' && !isMatchFinished && <span className="bg-red-600 text-white px-1.5 rounded text-[10px] animate-pulse">DEFENSE</span>}
          </p>
          <p className="text-yellow-400 text-sm font-mono truncate">
            {editingEventId ? "Select the CORRECT player from the list below" : message}
          </p>
        </div>

        {/* Scoreboard */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 bg-gray-900 px-6 py-1 rounded-lg border border-gray-700 shrink-0">
            <div className="text-center">
                <p className="text-[10px] text-gray-500 font-bold">HOME</p>
                <div className="text-3xl font-bold text-white flex items-center gap-2">
                    {homeScore}
                    {!isMatchFinished && (
                        <div className="flex flex-col gap-0.5">
                            <button onClick={() => setHomeScore(s => s + 1)} className="text-[8px] bg-gray-700 hover:bg-green-600 w-4 h-3 rounded flex items-center justify-center">▲</button>
                            <button onClick={() => setHomeScore(s => Math.max(0, s - 1))} className="text-[8px] bg-gray-700 hover:bg-red-600 w-4 h-3 rounded flex items-center justify-center">▼</button>
                        </div>
                    )}
                </div>
            </div>
            <div className="text-gray-600 font-bold text-3xl">:</div>
            <div className="text-center">
                <p className="text-[10px] text-gray-500 font-bold">AWAY</p>
                <div className="text-3xl font-bold text-white flex items-center gap-2">
                    {awayScore}
                    {!isMatchFinished && (
                        <div className="flex flex-col gap-0.5">
                            <button onClick={() => setAwayScore(s => s + 1)} className="text-[8px] bg-gray-700 hover:bg-green-600 w-4 h-3 rounded flex items-center justify-center">▲</button>
                            <button onClick={() => setAwayScore(s => Math.max(0, s - 1))} className="text-[8px] bg-gray-700 hover:bg-red-600 w-4 h-3 rounded flex items-center justify-center">▼</button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Right Controls */}
        <div className="flex gap-2 justify-end shrink-0">
           {editingEventId ? (
             <button onClick={() => setEditingEventId(null)} className="bg-gray-600 px-4 py-2 rounded flex items-center gap-2 font-bold hover:bg-gray-500"><XCircle size={16} /> Cancel</button>
           ) : (
             !isMatchFinished && (
                <>
                    {/* Opponent Score Button (Visible in Defense) */}
                    {currentPhase === 'defense' && (
                         <button onClick={handleOpponentScore} className="bg-red-900/80 hover:bg-red-800 border border-red-500 px-2 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold text-red-100">
                             Opp. Goal
                         </button>
                    )}
                    
                    {currentPhase === 'offense' && pendingLocation && <button onClick={initiateTurnoverSequence} className="bg-red-600 px-3 py-1.5 rounded font-bold animate-pulse text-xs">TURN</button>}
                    
                    <button onClick={submitStats} className="bg-blue-600 px-3 py-1.5 rounded flex gap-2 items-center text-xs"><Send size={14} /> Send</button>
                    <button onClick={resetMatch} className="bg-gray-600 px-3 py-1.5 rounded"><RotateCcw size={14} /></button>
                </>
             )
           )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* MATCH STATS OVERLAY (Full Screen) */}
        {isMatchFinished ? (
            <div className="absolute inset-0 z-50 bg-gray-900 flex flex-col items-center p-6 overflow-y-auto">
                <Trophy size={64} className="text-yellow-400 mb-4" />
                <h2 className="text-3xl font-bold text-white mb-2">MATCH COMPLETED</h2>
                <div className="text-6xl font-black text-gray-200 mb-8">{homeScore} - {awayScore}</div>
                
                {/* PLAYER TABLE */}
                <div className="w-full max-w-5xl bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl mb-8">
                    <div className="p-3 bg-gray-700 font-bold text-gray-200 border-b border-gray-600">Player Statistics</div>
                    <table className="w-full text-left text-sm text-gray-300">
                        <thead className="bg-gray-700/50 text-gray-100 uppercase text-xs">
                            <tr>
                                <th className="p-3">Player</th>
                                <th className="p-3 text-center">Goals</th>
                                <th className="p-3 text-center">Assists</th>
                                <th className="p-3 text-center">Blocks</th>
                                <th className="p-3 text-center">Passes</th>
                                <th className="p-3 text-center">Catches</th>
                                <th className="p-3 text-center text-red-400">Throw Err</th>
                                <th className="p-3 text-center text-red-400">Drop Err</th>
                                <th className="p-3 text-right">Tot. Dist</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRoster.map(player => {
                                const stats = matchData.playerStats[player.name];
                                const hasStats = stats.passes + stats.received + stats.scores + stats.assists + stats.turnovers + stats.blocks > 0;
                                return (
                                    <tr key={player.id} className={`border-b border-gray-700/50 hover:bg-gray-700/30 ${hasStats ? 'text-white' : 'text-gray-500'}`}>
                                        <td className="p-3 font-medium flex items-center gap-2">
                                            <span className="text-gray-500 w-6">#{player.number}</span>
                                            {player.name}
                                        </td>
                                        <td className={`p-3 text-center ${stats.scores > 0 ? 'text-green-400 font-bold' : ''}`}>{stats.scores}</td>
                                        <td className={`p-3 text-center ${stats.assists > 0 ? 'text-purple-400 font-bold' : ''}`}>{stats.assists}</td>
                                        <td className={`p-3 text-center ${stats.blocks > 0 ? 'text-blue-400 font-bold' : ''}`}>{stats.blocks}</td>
                                        <td className="p-3 text-center">{stats.passes}</td>
                                        <td className="p-3 text-center">{stats.received}</td>
                                        <td className="p-3 text-center">{stats.throw_errors}</td>
                                        <td className="p-3 text-center">{stats.drop_errors}</td>
                                        <td className="p-3 text-right font-mono">{stats.total_dist.toFixed(0)}m</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* CONNECTION TABLE */}
                <div className="w-full max-w-5xl bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl">
                     <div className="p-3 bg-gray-700 font-bold text-gray-200 border-b border-gray-600 flex items-center gap-2">
                         <Network size={16} /> Top Connections (Thrower ➝ Receiver)
                     </div>
                     <table className="w-full text-left text-sm text-gray-300">
                        <thead className="bg-gray-700/50 text-gray-100 uppercase text-xs">
                            <tr>
                                <th className="p-3">Pair</th>
                                <th className="p-3 text-center text-green-400">Completions</th>
                                <th className="p-3 text-center text-red-400">Drops</th>
                                <th className="p-3 text-center text-amber-400">Throw Errors</th>
                            </tr>
                        </thead>
                        <tbody>
                            {matchData.connectionStats.map((conn, idx) => (
                                <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                                    <td className="p-3 font-mono">{conn.pair}</td>
                                    <td className="p-3 text-center font-bold text-green-400">{conn.completions}</td>
                                    <td className="p-3 text-center">{conn.drops > 0 ? conn.drops : '-'}</td>
                                    <td className="p-3 text-center">{conn.throw_errors > 0 ? conn.throw_errors : '-'}</td>
                                </tr>
                            ))}
                            {matchData.connectionStats.length === 0 && (
                                <tr><td colSpan={4} className="p-4 text-center text-gray-500 italic">No connections recorded yet.</td></tr>
                            )}
                        </tbody>
                     </table>
                </div>
                
                <button onClick={resetMatch} className="mt-8 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 flex items-center gap-2">
                    <RotateCcw size={20} /> Start New Match
                </button>
            </div>
        ) : (
            <>
                {/* NEXT POINT / MATCH END OVERLAYS */}
                {showNextPointPrompt && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
                        <div className="p-8 rounded-xl bg-gray-800 shadow-2xl text-center border-2 border-green-500 w-[90%] max-w-md">
                            <Trophy size={48} className="text-green-500 mx-auto mb-4" />
                            <h2 className="text-3xl font-black text-white mb-6 tracking-tight">POINT SCORED!</h2>
                            <div className="flex flex-col gap-3">
                                <button 
                                    onClick={handleNextPoint} 
                                    className="bg-green-600 hover:bg-green-700 text-white text-lg font-bold px-6 py-4 rounded-lg flex items-center justify-center gap-3 transition-colors shadow-lg"
                                >
                                    <SkipForward size={24} /> Start Next Point
                                </button>
                                <button 
                                    onClick={requestMatchEnd} 
                                    className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-bold px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                                >
                                    Match Ended
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showMatchEndConfirm && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/90 backdrop-blur-md">
                        <div className="p-6 rounded-xl bg-gray-800 shadow-2xl text-center border border-red-500 w-[90%] max-w-sm">
                            <Ban size={40} className="text-red-500 mx-auto mb-3" />
                            <h3 className="text-xl font-bold text-white mb-2">End Match?</h3>
                            <p className="text-gray-400 mb-6 text-sm">This will conclude the game and generate the final statistics report. This cannot be undone.</p>
                            <div className="flex gap-3 justify-center">
                                <button onClick={cancelMatchEnd} className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-bold">Cancel</button>
                                <button onClick={confirmMatchEnd} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-bold flex items-center gap-2"><CheckCircle size={16} /> Confirm</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* TURNOVER TYPE PROMPT */}
                {showTurnoverTypePrompt && (
                     <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
                         <div className="p-6 rounded-xl bg-gray-800 shadow-2xl text-center border border-amber-500 w-[90%] max-w-sm">
                             <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
                             <h3 className="text-xl font-bold text-white mb-4">Turnover Type</h3>
                             <div className="grid grid-cols-2 gap-3">
                                 <button onClick={() => handleTurnoverSelection('throw')} className="bg-amber-700/50 hover:bg-amber-600 border border-amber-500 p-4 rounded-lg flex flex-col items-center gap-2 transition-colors">
                                     <Send className="rotate-180" size={24} />
                                     <span className="font-bold text-sm">Throw Error</span>
                                     <span className="text-[10px] text-gray-400">Bad Pass / Stall</span>
                                 </button>
                                 <button onClick={() => handleTurnoverSelection('receive')} className="bg-red-900/50 hover:bg-red-800 border border-red-500 p-4 rounded-lg flex flex-col items-center gap-2 transition-colors">
                                     <Hand size={24} />
                                     <span className="font-bold text-sm">Receive Error</span>
                                     <span className="text-[10px] text-gray-400">Drop / Miss</span>
                                 </button>
                             </div>
                             <button onClick={() => setShowTurnoverTypePrompt(false)} className="mt-4 text-gray-400 text-sm hover:text-white">Cancel</button>
                         </div>
                     </div>
                )}

                {/* LEFT: Roster */}
                <div className={`w-20 md:w-56 bg-gray-800 border-r border-gray-700 flex flex-col overflow-y-auto shrink-0 hidden md:flex ${editingEventId || showNextPointPrompt || showMatchEndConfirm || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="p-3 font-bold text-gray-400 uppercase text-xs border-b border-gray-700">Team Roster</div>
                {sortedRoster.map(player => {
                    const isSelected = lineup.find(p => p.id === player.id);
                    return (
                    <div key={player.id} onClick={() => toggleLineup(player)} className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-700 transition-colors border-b border-gray-700/50 relative ${isSelected ? 'bg-green-900/20' : ''}`}>
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
                <div className={`flex-1 relative bg-gray-900 flex justify-center overflow-y-auto p-2 touch-none ${editingEventId || showNextPointPrompt || showMatchEndConfirm || showTurnoverTypePrompt || isSelectingDropper || isSelectingIntended ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
                
                {/* HUD */}
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
                
                {/* DEFENSE OVERLAY HINT */}
                {currentPhase === 'defense' && !showTurnoverTypePrompt && !showNextPointPrompt && !showMatchEndConfirm && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none opacity-50">
                        <div className="flex flex-col items-center">
                             <ShieldAlert size={64} className="text-red-500 animate-pulse" />
                             <span className="text-red-500 font-black text-xl tracking-widest uppercase mt-2">DEFENSE</span>
                        </div>
                    </div>
                )}

                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_LENGTH}`}
                    className={`h-full w-auto max-w-full cursor-crosshair shadow-2xl border-2 transition-colors duration-500 ${currentPhase === 'defense' ? 'bg-red-950/40 border-red-900' : 'bg-green-700 border-white'}`}
                    onClick={handleFieldClick}
                    onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                    onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
                    preserveAspectRatio="xMidYMid meet"
                >
                    <rect x="0" y="0" width={FIELD_WIDTH} height={ENDZONE_DEPTH} fill="rgba(255,255,255,0.15)" />
                    <line x1="0" y1={ENDZONE_DEPTH} x2={FIELD_WIDTH} y2={ENDZONE_DEPTH} stroke="white" strokeWidth="0.5" />
                    <rect x="0" y={FIELD_LENGTH - ENDZONE_DEPTH} width={FIELD_WIDTH} height={ENDZONE_DEPTH} fill="rgba(255,255,255,0.15)" />
                    <line x1="0" y1={FIELD_LENGTH - ENDZONE_DEPTH} x2={FIELD_WIDTH} y2={FIELD_LENGTH - ENDZONE_DEPTH} stroke="white" strokeWidth="0.5" />
                    <line x1="19" y1={ENDZONE_DEPTH + 20} x2="21" y2={ENDZONE_DEPTH + 20} stroke="white" strokeWidth="0.5" />
                    <line x1="19" y1={FIELD_LENGTH - ENDZONE_DEPTH - 20} x2="21" y2={FIELD_LENGTH - ENDZONE_DEPTH - 20} stroke="white" strokeWidth="0.5" />

                    {events.map((evt, i) => {
                    if (i === 0) return null; 
                    const prev = events[i - 1];
                    if (!prev) return null;
                    
                    const lineColor = evt.type === 'turnover' ? 'red' : 'rgba(255,255,255,0.4)';
                    const lineOpacity = evt.type === 'turnover' ? 0.8 : 0.4;
                    
                    // Don't draw line for opponent turn/score events if they break continuity visual
                    if (evt.type === 'opponent_score' || evt.type === 'opponent_turn') return null;

                    return <line key={`l-${evt.id}`} x1={prev.location.x} y1={prev.location.y} x2={evt.location.x} y2={evt.location.y} stroke={lineColor} strokeWidth="0.3" strokeDasharray="1,0.5" opacity={lineOpacity} />;
                    })}
                    
                    {events.map((evt) => {
                    if (evt.type === 'opponent_score') return null;
                    const p = getPlayerDetails(evt.player_name);
                    const isOpponent = evt.player_name === 'Opponent';
                    
                    // If simple point history, show dots.
                    const isCur = currentPossessor?.name === evt.player_name && events[events.length-1].id === evt.id;
                    const size = 3;
                    const strokeColor = evt.type === 'goal' ? 'gold' : evt.type === 'turnover' ? 'red' : 'white';
                    
                    if (isOpponent) {
                        return (
                             <g key={evt.id}>
                                 <circle cx={evt.location.x} cy={evt.location.y} r={1.5} fill="red" opacity="0.5" />
                                 <XCircle x={evt.location.x - 1.5} y={evt.location.y - 1.5} size={3} color="red" />
                             </g>
                        );
                    }
                    
                    if (!p) return null;

                    return (
                        <g key={evt.id} opacity={isCur ? 1 : 0.6}>
                        <image href={getAvatar(p.gender)} x={evt.location.x - size/2} y={evt.location.y - size/2} height={size} width={size} className="rounded-full" />
                        <circle cx={evt.location.x} cy={evt.location.y} r={size/2} fill="none" stroke={strokeColor} strokeWidth="0.2" />
                        <rect x={evt.location.x - 1.5} y={evt.location.y - size + 0.5} width="3" height="1.5" rx="0.5" fill="rgba(0,0,0,0.8)" />
                        <text x={evt.location.x} y={evt.location.y - size + 1.5} fontSize="1" fill="white" textAnchor="middle" fontWeight="bold">#{p?.number}</text>
                        {isCur && <circle cx={evt.location.x} cy={evt.location.y} r={size/2 + 0.5} stroke="yellow" strokeWidth="0.3" fill="none"><animate attributeName="stroke-width" values="0.1;0.5;0.1" dur="1.5s" repeatCount="indefinite" /></circle>}
                        </g>
                    );
                    })}
                    
                    {isDragging && activeThrowerLoc && dragLocation && <line x1={activeThrowerLoc.x} y1={activeThrowerLoc.y} x2={dragLocation.x} y2={dragLocation.y} stroke="yellow" strokeWidth="0.5" strokeDasharray="0.5,0.5" />}
                    
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
                    <div className="p-3 font-bold text-gray-400 uppercase text-xs border-b border-gray-700 flex items-center gap-2"><ScrollText size={14} /> Action Log</div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-0 flex flex-col-reverse" ref={logContainerRef}>
                        {events.length === 0 && <p className="text-gray-500 text-xs italic text-center mt-4">No events yet.</p>}
                        {renderActionLog()}
                    </div>
                </div>
            </>
        )}
      </div>

      {/* BOTTOM BAR */}
      {!isMatchFinished && (
        <div className={`bg-gray-800 p-2 border-t border-gray-700 min-h-[140px] shrink-0 overflow-x-auto ${editingEventId ? 'bg-amber-950/30 border-t-2 border-amber-500' : ''}`}>
            {lineup.length === 7 && (
                <div className="flex justify-start items-center gap-4 px-4 pt-1 pb-2">
                    <button onClick={() => setShowPlayerStats(s => !s)} className="bg-gray-600 hover:bg-gray-500 text-xs text-white px-3 py-1 rounded flex items-center gap-1.5 transition-colors shrink-0">
                        {showPlayerStats ? <EyeOff size={14} /> : <Eye size={14} />}{showPlayerStats ? "Hide Stats" : "Show Stats"}
                    </button>
                    <span className="text-gray-400 text-xs truncate hidden sm:inline">
                        {isSelectingDropper ? <span className="text-red-400 font-bold animate-pulse">⚠ SELECT PLAYER WHO DROPPED THE DISC</span> : 
                         isSelectingIntended ? <span className="text-amber-400 font-bold animate-pulse">⚠ SELECT INTENDED RECEIVER (OR TAP FIELD IF NONE)</span> :
                         currentPhase === 'defense' ? <span className="text-blue-300 font-bold">DEFENSE MODE: Tap Player for Block (D)</span> :
                        "Tap receiver to track completion. Drag from card to throw."}
                    </span>
                </div>
            )}
            {editingEventId ? (
                <div className="flex justify-start md:justify-center gap-4 min-w-max px-4">
                    <div className="flex flex-col justify-center items-center mr-4 text-amber-500 font-bold text-xs uppercase w-24 text-center">Correct to:</div>
                    {sortedLineup.map(player => (
                        <div key={player.id} onClick={() => handlePlayerSelect(player)} className="flex flex-col items-center cursor-pointer active:scale-95 w-24 h-[120px] rounded-lg border-2 border-amber-500 bg-amber-900/40 p-2">
                            <span className="text-lg font-bold text-gray-200 leading-none mb-1">#{player.number}</span>
                            <img src={getAvatar(player.gender)} alt="" className="w-10 h-10 rounded-full border-2 border-amber-500 bg-gray-700" />
                            <span className="mt-1 text-xs truncate max-w-full font-medium text-amber-200">{player.name}</span>
                        </div>
                    ))}
                </div>
            ) : (
                lineup.length < 7 ? (
                <div className="text-center text-gray-400 py-4 flex flex-col items-center"><Users className="mb-2" /><p className="text-sm">Select 7 players from left roster</p></div>
                ) : (
                <div className="flex justify-start md:justify-center gap-2 min-w-max px-4">
                    {sortedLineup.map(player => {
                        const isPossessor = currentPossessor?.id === player.id;
                        const isClickable = !!pendingLocation || !currentPossessor || isSelectingDropper || isSelectingIntended || currentPhase === 'defense';
                        const stats = pointData.playerStats[player.name] || { passes: 0, received: 0, assists: 0, scores: 0, avg_hold_time: '0.0', total_dist: 0, avg_dist: '0.0', turnover_dist: 0, blocks: 0 };
                        
                        const shouldRenderCard = !(isPossessor && isDragging) || isSelectingDropper || isSelectingIntended; 
                        if (!shouldRenderCard) return null;

                        const cardClasses = getCardClasses(player, isClickable, isPossessor);
                        const handleClick = () => {
                            if (isSelectingDropper || isSelectingIntended || currentPhase === 'defense') { handlePlayerSelect(player); return; }

                            if (isPossessor && pendingLocation) { handlePlayerSelect(player); }
                            else if (!currentPossessor && !pendingLocation) { setPendingLocation({x:20, y:100}); handlePlayerSelect(player); } 
                            else if (isClickable && !isPossessor) { handlePlayerSelect(player); }
                        };
                        return (
                        <div key={player.id} onClick={handleClick} className={cardClasses} style={isPossessor ? {boxShadow: '0 0 10px #facc15'} : {}}>
                            <div className="w-full flex items-center justify-between text-xs mb-1"><span className="text-xl font-black">#{player.number}</span><span className="text-[10px] font-medium text-gray-300 truncate max-w-[60%] text-right">{player.name}</span></div>
                            <div className="flex-shrink-0 mb-1"><img src={getAvatar(player.gender)} alt="" className="w-9 h-9 rounded-full border-2 border-white/50 bg-gray-700" /></div>
                            {isPossessor && !isSelectingDropper && !isSelectingIntended && <div className="absolute top-1 left-1.5 w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>}
                            {showPlayerStats ? (
                                <div className="flex flex-col w-full text-[7px] font-mono font-bold mt-1 text-left pt-1 border-t border-gray-600/50">
                                    <span className="flex justify-between">#Passes: <span className={stats.passes > 0 ? 'text-blue-400' : 'text-gray-300'}>{stats.passes}</span></span>
                                    <span className="flex justify-between">#Receive: <span className={stats.received > 0 ? 'text-green-400' : 'text-gray-300'}>{stats.received}</span></span>
                                    <span className="flex justify-between">Assist: <span className={stats.assists > 0 ? 'text-purple-400' : 'text-gray-300'}>{stats.assists}</span></span>
                                    <span className="flex justify-between">Score: <span className={stats.scores > 0 ? 'text-red-400' : 'text-gray-300'}>{stats.scores}</span></span>
                                    <span className="flex justify-between">Block (D): <span className={stats.blocks > 0 ? 'text-blue-400' : 'text-gray-300'}>{stats.blocks}</span></span>
                                    <span className="flex justify-between">Turn Dist: <span className={stats.turnover_dist > 0 ? 'text-red-400' : 'text-gray-300'}>{stats.turnover_dist.toFixed(0)}m</span></span>
                                    <span className="flex justify-between">Avg. Hold: <span className={stats.avg_hold_time !== '0.0' ? 'text-yellow-400' : 'text-gray-300'}>{stats.avg_hold_time}s</span></span>
                                </div>
                            ) : (
                                <div className="absolute bottom-1 w-full text-center">
                                    <span className="text-[10px] font-medium text-gray-400">
                                        {isSelectingDropper ? 'TAP IF DROPPED' : 
                                         isSelectingIntended ? 'TAP INTENDED' :
                                         currentPhase === 'defense' ? 'TAP FOR BLOCK' :
                                         isPossessor ? 'THROWER' : 'RECEIVER'}
                                    </span>
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
                )
            )}
        </div>
      )}
    </div>
  );
};

export default PitchMap;