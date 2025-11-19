import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, query, orderBy, getDocs, deleteDoc, Firestore } from 'firebase/firestore';
import { Truck, Cloud, RefreshCw, Download, Droplet, Beaker, Activity, CheckCircle2, Trash2, Printer, RotateCcw, AlertTriangle } from 'lucide-react'; 

import { ALL_ROADS, ALL_CHEMICALS, WIND_DIRECTIONS } from './constants';
import { Chemical, ChemicalState, LogEntry, WeatherConditions, FirebaseConfig } from './types';

// --- Environment and Firebase Setup Variables ---
declare global {
    interface Window {
        __firebase_config?: string;
        __app_id?: string;
        __initial_auth_token?: string;
    }
}

const firebaseConfig: FirebaseConfig = typeof window !== 'undefined' && window.__firebase_config 
    ? JSON.parse(window.__firebase_config) 
    : {};
const appId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : 'default-app-id'; 
const initialAuthToken = typeof window !== 'undefined' && window.__initial_auth_token ? window.__initial_auth_token : null; 

const getCollectionPath = (uid: string) =>
    `artifacts/${appId}/users/${uid}/gallon_logs`;

// Function to format weather summary for the history table
const formatWeatherSummary = (conditions: WeatherConditions | undefined) => {
    if (!conditions || !conditions.weather) return 'N/A';
    const { weather, temperature, windDirection, windSpeed } = conditions;
    const temp = typeof temperature === 'number' ? `${temperature}°F` : '';
    const wind = typeof windSpeed === 'number' && windSpeed > 0 ? `${windSpeed} MPH (${windDirection})` : '';
    return `${weather} | ${temp} | Wind: ${wind}`;
}

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    // --- FIREBASE STATE ---
    const [db, setDb] = useState<Firestore | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [auth, setAuth] = useState<Auth | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    
    // --- INVENTORY STATE ---
    const [startingGallons, setStartingGallons] = useState(600);
    const [gallonsUsedOnRoad, setGallonsUsedOnRoad] = useState(0);
    const [gallonsLeft, setGallonsLeft] = useState(600); 
    const [gallonsToRefill, setGallonsToRefill] = useState(0); 
    
    // --- CHEMICAL MIX STATE ---
    const [chemicalMix, setChemicalMix] = useState<Chemical[]>([]);
    const [currentChemical, setCurrentChemical] = useState<ChemicalState>({ name: '', totalOz: 0 });
    const [chemicalSearch, setChemicalSearch] = useState('');
    const [isChemicalDropdownVisible, setIsChemicalDropdownVisible] = useState(false);

    // --- ROAD SELECTION STATE ---
    const [roadSearch, setRoadSearch] = useState('');
    const [selectedRoad, setSelectedRoad] = useState('');
    const [isDropdownVisible, setIsDropdownVisible] = useState(false);

    // --- ENVIRONMENTAL CONDITIONS STATE (User Input State) ---
    const [weather, setWeather] = useState('');
    const [temperature, setTemperature] = useState(70);
    const [windDirection, setWindDirection] = useState('South West');
    const [windSpeed, setWindSpeed] = useState(5);

    // --- UI/STATUS STATE ---
    const [status, setStatus] = useState('Initializing...');
    const [showConfirmModal, setShowConfirmModal] = useState(false); 

    // --- STATUS MESSAGE HANDLER ---
    const updateStatus = useCallback((message: string) => {
        setStatus(message);
        console.log(`Status: ${message}`); 
    }, []);

    // --- FIREBASE INITIALIZATION ---
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            updateStatus('Error: Firebase Config Missing.');
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const dbInstance = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(dbInstance);
            setAuth(authInstance);

            onAuthStateChanged(authInstance, async (user) => {
                let currentUserId = user ? user.uid : null;
                if (!currentUserId) {
                    if (initialAuthToken) { 
                        await signInWithCustomToken(authInstance, initialAuthToken);
                        if (authInstance.currentUser) currentUserId = authInstance.currentUser.uid;
                    } else {
                        await signInAnonymously(authInstance);
                        if (authInstance.currentUser) currentUserId = authInstance.currentUser.uid;
                    }
                }
                setUserId(currentUserId);
                setIsAuthReady(true);
                updateStatus('System Ready.');
            });
        } catch (error) {
            console.error("Firebase setup error:", error);
            updateStatus('Initialization Failed.');
        }
    }, [updateStatus]);

    // --- REAL-TIME HISTORY LISTENER ---
    useEffect(() => {
        if (!db || !userId) return;

        const logsQuery = query(collection(db, getCollectionPath(userId)), orderBy("timestamp", "asc"));

        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
            const fetchedLogs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as LogEntry[];
            
            setLogs(fetchedLogs.slice().reverse()); 
            
            const lastLog = fetchedLogs[fetchedLogs.length - 1]; 
            if (lastLog && typeof lastLog.gallonsLeft === 'number') {
                setGallonsLeft(lastLog.gallonsLeft);
            } else {
                setGallonsLeft(startingGallons); 
            }
            
            if (lastLog && typeof lastLog.initialTankVolume === 'number') {
                setStartingGallons(lastLog.initialTankVolume);
            }

        }, (error) => {
            console.error("Snapshot error:", error);
            updateStatus('Error loading logs.');
        });

        return () => unsubscribe();
    }, [db, userId, startingGallons, updateStatus]);

    // --- DERIVED STATE ---
    const lastAppliedConditions = useMemo(() => {
        const lastAppLog = logs.find(log => log.roadName !== "TANK REFILL" && log.weatherConditions && log.weatherConditions.weather);
        if (lastAppLog && lastAppLog.weatherConditions) {
            setWeather(lastAppLog.weatherConditions.weather || '');
            setTemperature(lastAppLog.weatherConditions.temperature || 70);
            setWindDirection(lastAppLog.weatherConditions.windDirection || 'South West');
            setWindSpeed(lastAppLog.weatherConditions.windSpeed || 5);
            return lastAppLog.weatherConditions; 
        }
        return null;
    }, [logs]);
    
    const formattedConditions = useMemo(() => lastAppliedConditions ? formatWeatherSummary(lastAppliedConditions) : null, [lastAppliedConditions]);

    // --- LOGIC: Selection & Mix ---
    const filteredRoads = useMemo(() => {
        if (!roadSearch) return ALL_ROADS;
        const lowerCaseSearch = roadSearch.toLowerCase();
        return ALL_ROADS.filter(road => road.toLowerCase().startsWith(lowerCaseSearch));
    }, [roadSearch]);

    const handleRoadSelect = (road: string) => {
        setRoadSearch(road);
        setSelectedRoad(road);
        setIsDropdownVisible(false);
    };

    const filteredChemicals = useMemo(() => {
        if (!chemicalSearch) return ALL_CHEMICALS;
        const lowerCaseSearch = chemicalSearch.toLowerCase();
        return ALL_CHEMICALS.filter(chemical => chemical.toLowerCase().startsWith(lowerCaseSearch));
    }, [chemicalSearch]);

    const handleChemicalSelect = (chemical: string) => {
        setChemicalSearch(chemical);
        setCurrentChemical(prev => ({...prev, name: chemical}));
        setIsChemicalDropdownVisible(false);
    };

    const calculateOzPerGal = (totalOz: string | number, tankVolume: number) => {
        const numTotalOz = parseFloat(totalOz.toString());
        return tankVolume > 0 ? (numTotalOz / tankVolume).toFixed(4) : '0';
    };

    const handleChemicalAdd = () => {
        const totalOzValue = parseFloat(currentChemical.totalOz.toString());
        if (!currentChemical.name || isNaN(totalOzValue) || totalOzValue <= 0) {
            updateStatus('Enter valid chemical and amount.');
            return;
        }
        const newChemical: Chemical = {
            name: currentChemical.name,
            totalOz: totalOzValue, 
            ozPerGal: calculateOzPerGal(totalOzValue, startingGallons)
        };
        setChemicalMix(prev => [...prev, newChemical]);
        setCurrentChemical({ name: '', totalOz: 0 });
        setChemicalSearch('');
    };

    const handleChemicalRemove = (index: number) => {
        setChemicalMix(prev => prev.filter((_, i) => i !== index));
    };

    useEffect(() => {
        setChemicalMix(prevMix =>
            prevMix.map(chem => ({
                ...chem,
                ozPerGal: calculateOzPerGal(chem.totalOz, startingGallons)
            }))
        );
    }, [startingGallons]);

    // --- LOGIC: Refill & Log ---
    const performRefill = async (gallonsAdded: number) => {
        if (!isAuthReady || !db || !userId) {
            updateStatus('System initializing...');
            return;
        }
        const currentTotal = gallonsLeft + gallonsAdded;
        const newGallonsLeft = Math.min(startingGallons, currentTotal);
        const actualAdded = newGallonsLeft - gallonsLeft;
        
        if (actualAdded <= 0.01) {
             updateStatus(`Tank full or invalid amount.`);
            return;
        }

        try {
            await addDoc(collection(db, getCollectionPath(userId)), {
                roadName: "TANK REFILL",
                gallonsUsed: -actualAdded,
                gallonsLeft: parseFloat(newGallonsLeft.toFixed(2)),
                initialTankVolume: startingGallons,
                chemicalMix: [],
                weatherConditions: {},
                timestamp: serverTimestamp()
            });
            updateStatus(`Refilled ${actualAdded.toFixed(2)} gal.`);
            setGallonsToRefill(0);
        } catch (e) {
            console.error("Refill Error:", e);
            updateStatus('Error saving refill log.');
        }
    };

    const handleRefill = () => {
        const gallons = typeof gallonsToRefill === 'string' ? parseFloat(gallonsToRefill) : gallonsToRefill;
        if (isNaN(gallons) || gallons <= 0) {
            updateStatus('Enter positive refill amount.');
            return;
        }
        performRefill(gallons);
    };

    const logApplication = async () => {
        const gallonsUsed = typeof gallonsUsedOnRoad === 'string' ? parseFloat(gallonsUsedOnRoad) : gallonsUsedOnRoad;
        
        if (!selectedRoad?.trim()) { updateStatus('Select a Road.'); return; }
        if (isNaN(gallonsUsed) || gallonsUsed <= 0) { updateStatus('Invalid Gallons Used.'); return; }
        if (gallonsUsed > gallonsLeft) { updateStatus(`Not enough gallons remaining.`); return; }
        if (chemicalMix.length === 0) { updateStatus('Add chemicals first.'); return; }
        if (!weather.trim() || !temperature || !windDirection || !windSpeed) { updateStatus('Check environmental fields.'); return; }
        if (!isAuthReady || !db || !userId) { updateStatus('Initializing...'); return; }

        const newGallonsLeft = gallonsLeft - gallonsUsed;
        
        try {
            await addDoc(collection(db, getCollectionPath(userId)), {
                roadName: selectedRoad,
                gallonsUsed: parseFloat(gallonsUsed.toFixed(2)),
                gallonsLeft: parseFloat(newGallonsLeft.toFixed(2)),
                initialTankVolume: startingGallons,
                chemicalMix: chemicalMix,
                weatherConditions: {
                    weather: weather.trim(),
                    temperature: typeof temperature === 'string' ? parseFloat(temperature) : temperature,
                    windDirection: windDirection,
                    windSpeed: typeof windSpeed === 'string' ? parseFloat(windSpeed) : windSpeed,
                },
                timestamp: serverTimestamp()
            });

            setGallonsUsedOnRoad(0);
            setSelectedRoad('');
            setRoadSearch('');
            updateStatus(`Logged ${selectedRoad}.`);

        } catch (e) {
            console.error("Log Error:", e);
            updateStatus('Error saving log.');
        }
    };
    
    // --- REPORT GENERATION ---
    const generateReportContent = useCallback(() => {
        const applicationLogs = logs.filter(log => log.roadName !== "TANK REFILL");
        const refillLogs = logs.filter(log => log.roadName === "TANK REFILL");
        
        let txtContent = '============================================\n';
        txtContent += `APPLICATION HISTORY REPORT\n`;
        txtContent += '============================================\n';
        txtContent += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
        txtContent += `User ID: ${userId}\n`;
        txtContent += `Total Tank Capacity: ${startingGallons} gallons\n`;
        txtContent += '============================================\n\n';

        if (lastAppliedConditions) {
            const { weather, temperature, windDirection, windSpeed } = lastAppliedConditions;
            txtContent += '>>> ENVIRONMENTAL CONDITIONS (Last Logged) <<<\n';
            txtContent += `Weather: ${weather}\n`;
            txtContent += `Temperature: ${temperature}°F\n`;
            txtContent += `Wind: ${windSpeed} MPH from ${windDirection}\n`;
            txtContent += '--------------------------------------------\n\n';
        }

        txtContent += '>>> ROAD APPLICATION LOGS <<<\n';
        txtContent += '--------------------------------------------\n';
        
        if (applicationLogs.length === 0) {
            txtContent += 'No road application data to report.\n\n';
        } else {
            applicationLogs.forEach((log, index) => {
                const timestamp = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'N/A';
                txtContent += `ENTRY #${applicationLogs.length - index} (${timestamp})\n`;
                txtContent += `Road: ${log.roadName} | Used: ${log.gallonsUsed.toFixed(2)} gal | Left: ${log.gallonsLeft.toFixed(2)}\n`;
                log.chemicalMix.forEach(chem => {
                    const ozPerGal = typeof chem.ozPerGal === 'string' ? parseFloat(chem.ozPerGal) : (chem.ozPerGal || 0);
                    const applied = (log.gallonsUsed || 0) * ozPerGal;
                    txtContent += `    - ${chem.name}: ${applied.toFixed(2)} oz\n`;
                });
                txtContent += '---\n';
            });
        }
        
        txtContent += '\n>>> TANK REFILL LOGS <<<\n';
        txtContent += '--------------------------------------------\n';
        refillLogs.forEach((log, index) => {
             const timestamp = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'N/A';
             txtContent += `REFILL #${refillLogs.length - index} (${timestamp}) - Added ${Math.abs(log.gallonsUsed).toFixed(2)} gal\n`;
        });
        return txtContent;
    }, [logs, userId, startingGallons, lastAppliedConditions]);

    const downloadHistoryAsTxt = useCallback(() => {
        if (logs.length === 0) return;
        const txtContent = generateReportContent();
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Gallon_Log_Report_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateStatus('Report downloaded.');
    }, [logs, generateReportContent, updateStatus]);
    
    const handlePrintReport = useCallback(() => {
        if (logs.length === 0) return;
        const txtContent = generateReportContent();
        const printWindow = window.open('', '', 'height=600,width=800');
        if (!printWindow) { updateStatus('Pop-up blocked.'); return; }

        printWindow.document.write(`
            <html><head><title>Report</title>
            <style>body{font-family:monospace;white-space:pre-wrap;margin:20px;}@media print{body{font-size:10pt;}}</style>
            </head><body><pre>${txtContent}</pre></body></html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        updateStatus('Print dialog opened.');
    }, [logs, generateReportContent, updateStatus]);

    const confirmResetHistory = async () => {
        setShowConfirmModal(false); 
        try {
            if (!db || !userId) return;
            const snapshot = await getDocs(collection(db, getCollectionPath(userId)));
            await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
            
            setStartingGallons(600);
            setGallonsLeft(600); 
            setGallonsUsedOnRoad(0);
            setChemicalMix([]);
            setCurrentChemical({ name: '', totalOz: 0 });
            setChemicalSearch('');
            setRoadSearch('');
            setSelectedRoad('');
            setGallonsToRefill(0); 
            setWeather('');
            setTemperature(70);
            setWindDirection('South West');
            setWindSpeed(5);
            updateStatus('History Reset.');
        } catch (e) {
            console.error("Reset Error:", e);
            updateStatus('Reset Failed.');
        }
    };

    // --- VISUAL HELPERS ---
    const tankPercentage = Math.min(100, Math.max(0, (gallonsLeft / startingGallons) * 100));
    const tankColor = tankPercentage > 25 ? 'bg-emerald-500' : 'bg-red-500';

    // --- JSX ---
    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-200 selection:text-blue-900 pb-10">
            
            {/* --- HEADER --- */}
            <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-40 print-hide">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-indigo-600 p-2 rounded-lg shadow-md shadow-indigo-200">
                            <Truck className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">County Logger <span className="text-indigo-600">Pro</span></h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className={`flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full border ${isAuthReady ? 'bg-white border-slate-200 text-emerald-600 shadow-sm' : 'bg-white border-slate-200 text-yellow-600'}`}>
                            <div className={`w-2 h-2 rounded-full ${isAuthReady ? 'bg-emerald-500' : 'bg-yellow-400'}`}></div>
                            {isAuthReady ? 'Online' : 'Connecting...'}
                        </span>
                        {userId && <span className="hidden md:block text-xs text-slate-400 font-mono">{userId.slice(0, 6)}...</span>}
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 print-show">
                
                {/* --- TOP STATS & FEEDBACK --- */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print-hide">
                     {/* Status Bar */}
                    <div className="lg:col-span-3">
                         {status && (
                             <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-3 px-4 shadow-sm">
                                <span className="text-sm text-slate-600 font-medium flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-indigo-500" />
                                    System Status: <span className="text-slate-800">{status}</span>
                                </span>
                             </div>
                         )}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print-hide">
                    
                    {/* --- LEFT SIDEBAR: CONTROLS & CONFIG --- */}
                    <div className="lg:col-span-4 space-y-6">
                        
                        {/* 1. TANK MANAGEMENT */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                    <Droplet className="w-4 h-4 text-blue-500" /> Tank Management
                                </h3>
                            </div>
                            <div className="p-5 space-y-6">
                                {/* Gauge */}
                                <div className="text-center space-y-2">
                                    <div className="text-5xl font-bold text-slate-900 tracking-tight">
                                        {Math.max(0, gallonsLeft).toFixed(1)} <span className="text-lg text-slate-400 font-normal">gal</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                                        <div 
                                            className={`h-full transition-all duration-500 ease-out ${tankColor}`} 
                                            style={{ width: `${tankPercentage}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-slate-400">Current Level ({tankPercentage.toFixed(0)}%)</p>
                                </div>

                                {/* Controls */}
                                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Adjust Capacity</label>
                                        <input 
                                            type="number" 
                                            value={startingGallons}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 1;
                                                setStartingGallons(val);
                                                setGallonsLeft(prev => Math.min(val, prev));
                                            }}
                                            className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Add Gallons</label>
                                        <div className="flex">
                                            <input 
                                                type="number"
                                                placeholder="0"
                                                value={gallonsToRefill || ''}
                                                onChange={(e) => setGallonsToRefill(parseFloat(e.target.value) || 0)}
                                                className="w-full bg-white border border-slate-300 rounded-l-md px-2 py-1.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none z-10 transition-all"
                                            />
                                            <button 
                                                onClick={handleRefill}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 rounded-r-md flex items-center justify-center transition-colors"
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. CHEMICAL MIX */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-200">
                                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                    <Beaker className="w-4 h-4 text-purple-500" /> Chemical Mix
                                </h3>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input 
                                            type="text"
                                            placeholder="Search chemical..."
                                            value={chemicalSearch}
                                            onChange={(e) => {
                                                setChemicalSearch(e.target.value);
                                                setCurrentChemical(prev => ({...prev, name: e.target.value}));
                                                setIsChemicalDropdownVisible(true);
                                            }}
                                            onFocus={() => setIsChemicalDropdownVisible(true)}
                                            onBlur={() => setTimeout(() => setIsChemicalDropdownVisible(false), 200)}
                                            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none placeholder-slate-400 transition-all"
                                        />
                                        {isChemicalDropdownVisible && chemicalSearch && filteredChemicals.length > 0 && (
                                            <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-40 overflow-y-auto z-20">
                                                {filteredChemicals.map(c => (
                                                    <div key={c} onClick={() => handleChemicalSelect(c)} className="px-3 py-2 text-sm text-slate-700 hover:bg-purple-50 cursor-pointer">
                                                        {c}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="number"
                                            placeholder="Oz"
                                            value={currentChemical.totalOz || ''}
                                            onChange={(e) => setCurrentChemical(prev => ({...prev, totalOz: e.target.value}))}
                                            className="w-1/3 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                                        />
                                        <button 
                                            onClick={handleChemicalAdd}
                                            disabled={!currentChemical.name}
                                            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>

                                {/* List */}
                                <div className="space-y-2">
                                    {chemicalMix.length === 0 ? (
                                        <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg">
                                            <p className="text-xs text-slate-400">No chemicals added yet</p>
                                        </div>
                                    ) : (
                                        chemicalMix.map((chem, i) => (
                                            <div key={i} className="flex justify-between items-center bg-slate-50 border border-slate-200 p-2 rounded-md">
                                                <div>
                                                    <div className="text-xs font-medium text-slate-700 truncate max-w-[140px]">{chem.name}</div>
                                                    <div className="text-[10px] text-slate-500">{typeof chem.totalOz === 'number' ? chem.totalOz.toFixed(1) : chem.totalOz} oz ({chem.ozPerGal} oz/gal)</div>
                                                </div>
                                                <button onClick={() => handleChemicalRemove(i)} className="text-slate-400 hover:text-red-500 transition-colors">
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 3. CONDITIONS */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                             <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-200">
                                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                    <Cloud className="w-4 h-4 text-yellow-500" /> Conditions
                                </h3>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <input type="text" placeholder="Weather (e.g. Sunny)" value={weather} onChange={e => setWeather(e.target.value)}
                                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 outline-none transition-all" />
                                </div>
                                <div>
                                    <input type="number" placeholder="Temp °F" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))}
                                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 outline-none transition-all" />
                                </div>
                                <div>
                                     <input type="number" placeholder="Wind MPH" value={windSpeed} onChange={e => setWindSpeed(parseFloat(e.target.value))}
                                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 outline-none transition-all" />
                                </div>
                                <div className="col-span-2">
                                    <select value={windDirection} onChange={e => setWindDirection(e.target.value)}
                                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 outline-none appearance-none"
                                    >
                                        {WIND_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* --- RIGHT MAIN: ACTIONS & HISTORY --- */}
                    <div className="lg:col-span-8 space-y-6">
                        
                        {/* LOG ACTION CARD */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden relative group">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                            <div className="p-6 sm:p-8">
                                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                                    <CheckCircle2 className="w-6 h-6 text-blue-600" /> Log Application
                                </h2>
                                
                                <div className="space-y-5">
                                    <div className="relative">
                                        <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1 uppercase tracking-wide">Road Name</label>
                                        <input 
                                            type="text" 
                                            placeholder="Search for road..." 
                                            value={roadSearch}
                                            onChange={(e) => {
                                                setRoadSearch(e.target.value);
                                                setSelectedRoad(e.target.value);
                                                setIsDropdownVisible(true);
                                            }}
                                            onFocus={() => setIsDropdownVisible(true)}
                                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-4 text-lg text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm transition-all"
                                        />
                                        {isDropdownVisible && roadSearch && filteredRoads.length > 0 && (
                                            <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto z-30">
                                                {filteredRoads.map(r => (
                                                    <div key={r} onMouseDown={() => handleRoadSelect(r)} className="px-4 py-3 text-base text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer border-b border-slate-100 last:border-0 transition-colors">
                                                        {r}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1 uppercase tracking-wide">Gallons Used</label>
                                        <div className="flex gap-4">
                                            <input 
                                                type="number" 
                                                placeholder="0"
                                                value={gallonsUsedOnRoad || ''}
                                                onChange={(e) => setGallonsUsedOnRoad(parseFloat(e.target.value) || 0)}
                                                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-4 text-lg font-mono text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm transition-all"
                                            />
                                            <button 
                                                onClick={logApplication}
                                                disabled={!selectedRoad}
                                                className="w-40 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center leading-none"
                                            >
                                                <span className="text-lg">LOG</span>
                                                <span className="text-[10px] opacity-80 uppercase">Entry</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* HISTORY TABLE */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
                             <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-emerald-500" /> History Log
                                </h3>
                                <div className="flex gap-2">
                                    <button onClick={handlePrintReport} className="p-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors shadow-sm" title="Print">
                                        <Printer className="w-4 h-4" />
                                    </button>
                                    <button onClick={downloadHistoryAsTxt} className="p-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors shadow-sm" title="Download">
                                        <Download className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            
                            {formattedConditions && (
                                <div className="bg-slate-50 px-6 py-2 border-b border-slate-200 text-xs text-slate-500 font-mono flex items-center gap-2">
                                    <Cloud className="w-3 h-3" /> {formattedConditions}
                                </div>
                            )}

                            <div className="overflow-auto flex-1 custom-scrollbar">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-50 sticky top-0 text-xs font-bold uppercase text-slate-500 tracking-wider">
                                        <tr>
                                            <th className="px-6 py-3 border-b border-slate-200">Road</th>
                                            <th className="px-6 py-3 border-b border-slate-200">Usage</th>
                                            <th className="px-6 py-3 border-b border-slate-200">Mix Details</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                                        {logs.filter(l => l.roadName !== 'TANK REFILL').length === 0 ? (
                                            <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">No applications yet.</td></tr>
                                        ) : (
                                            logs.filter(l => l.roadName !== 'TANK REFILL').map((log) => (
                                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-6 py-3 font-medium text-slate-900">{log.roadName}</td>
                                                    <td className="px-6 py-3 font-mono text-emerald-600">{log.gallonsUsed.toFixed(1)}g</td>
                                                    <td className="px-6 py-3 text-xs text-slate-500">
                                                        {log.chemicalMix.map((c, i) => (
                                                            <span key={i} className="block">
                                                                {c.name}: <span className="text-slate-700 font-semibold">{(log.gallonsUsed * (typeof c.ozPerGal === 'number' ? c.ozPerGal : parseFloat(c.ozPerGal as string))).toFixed(1)} oz</span>
                                                            </span>
                                                        ))}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                         {/* RESTART BUTTON */}
                        <div className="flex justify-end pt-4">
                            <button 
                                onClick={() => setShowConfirmModal(true)}
                                className="flex items-center gap-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-all"
                            >
                                <RotateCcw className="w-3 h-3" /> Reset Job / New Mix
                            </button>
                        </div>
                    </div>
                </div>
            </main>

            {/* MODAL */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-slate-200 p-6 rounded-xl max-w-md w-full shadow-2xl space-y-4">
                        <div className="flex items-center gap-3 text-red-600">
                            <AlertTriangle className="w-8 h-8" />
                            <h3 className="text-lg font-bold text-slate-900">Reset Application?</h3>
                        </div>
                        <p className="text-slate-600 text-sm">This will permanently delete all history logs for this user and reset all tank settings. This action cannot be undone.</p>
                        <div className="flex justify-end gap-3 pt-2">
                            <button onClick={() => setShowConfirmModal(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
                            <button onClick={confirmResetHistory} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-red-200">Yes, Reset Everything</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;