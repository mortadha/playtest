import { useState, useEffect, useRef, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { 
    Play, 
    Stop, 
    Bug, 
    Link, 
    ClockCountdown, 
    Folder,
    MagnifyingGlass,
    Gear,
    ListBullets,
    Trash,
    Copy,
    ArrowClockwise,
    CheckCircle,
    WarningCircle,
    XCircle,
    Spinner
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

function App() {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [targetUrl, setTargetUrl] = useState("");
    const [fillForms, setFillForms] = useState(true);
    const [loginEmail, setLoginEmail] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [currentSession, setCurrentSession] = useState(null);
    const [logs, setLogs] = useState([]);
    const [bugs, setBugs] = useState([]);
    const [stats, setStats] = useState({
        urls_scanned: 0,
        elements_found: 0,
        forms_found: 0,
        bugs_found: 0
    });
    const [sessions, setSessions] = useState([]);
    const [history, setHistory] = useState({ sessions: [], tested_elements: {} });
    const wsRef = useRef(null);
    const logsEndRef = useRef(null);

    const addLog = useCallback((type, message) => {
        const timestamp = new Date().toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        setLogs(prev => [...prev.slice(-100), { type, message, timestamp }]);
    }, []);

    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(`${WS_URL}/api/ws`);
        
        ws.onopen = () => {
            addLog("info", "Connected to test server");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case "status":
                        setIsRunning(data.status === "running");
                        addLog("info", `Test status: ${data.status}`);
                        break;
                    case "progress":
                        addLog("info", data.message);
                        break;
                    case "action":
                        addLog("info", data.message);
                        break;
                    case "bug":
                        setBugs(prev => [...prev, data.bug]);
                        addLog("error", `BUG FOUND: ${data.bug.type} - ${data.bug.message}`);
                        break;
                    case "stats":
                        setStats(data);
                        break;
                    case "stopped":
                        setIsRunning(false);
                        addLog("error", data.reason);
                        break;
                    case "completed":
                        setIsRunning(false);
                        setCurrentSession(data.session);
                        addLog("success", `Test completed: ${data.status}`);
                        fetchSessions();
                        fetchHistory();
                        break;
                    case "error":
                        setIsRunning(false);
                        addLog("error", `Error: ${data.message}`);
                        break;
                    default:
                        break;
                }
            } catch (e) {
                console.error("WS parse error:", e);
            }
        };

        ws.onclose = () => {
            addLog("info", "Disconnected from server");
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = () => {
            addLog("error", "WebSocket error");
        };

        wsRef.current = ws;
    }, [addLog]);

    const fetchTestStatus = async () => {
        try {
            const response = await axios.get(`${API}/tests/status`);
            setIsRunning(response.data.running);
            if (response.data.session) {
                setCurrentSession(response.data.session);
                setStats({
                    urls_scanned: response.data.session.urls_scanned || 0,
                    elements_found: response.data.session.elements_found || 0,
                    forms_found: response.data.session.forms_found || 0,
                    bugs_found: response.data.session.bugs_found || 0
                });
                setBugs(response.data.session.bugs || []);
            }
        } catch (e) {
            console.error("Failed to fetch status:", e);
        }
    };

    const fetchSessions = async () => {
        try {
            const response = await axios.get(`${API}/tests/sessions`);
            setSessions(response.data);
        } catch (e) {
            console.error("Failed to fetch sessions:", e);
        }
    };

    const fetchHistory = async () => {
        try {
            const response = await axios.get(`${API}/tests/history`);
            setHistory(response.data);
        } catch (e) {
            console.error("Failed to fetch history:", e);
        }
    };

    useEffect(() => {
        connectWebSocket();
        fetchTestStatus();
        fetchSessions();
        fetchHistory();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connectWebSocket]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const startTest = async () => {
        if (!targetUrl) {
            addLog("error", "Please enter a target URL");
            return;
        }

        try {
            setLogs([]);
            setBugs([]);
            setStats({ urls_scanned: 0, elements_found: 0, forms_found: 0, bugs_found: 0 });

            const config = {
                target_url: targetUrl,
                fill_forms: fillForms,
                login_credentials: loginEmail && loginPassword ? {
                    email: loginEmail,
                    password: loginPassword
                } : null
            };

            const response = await axios.post(`${API}/tests/start`, config);
            setIsRunning(true);
            addLog("success", `Test started: ${response.data.session_id}`);
        } catch (e) {
            addLog("error", `Failed to start test: ${e.response?.data?.error || e.message}`);
        }
    };

    const stopTest = async () => {
        try {
            await axios.post(`${API}/tests/stop`);
            addLog("info", "Stopping test...");
        } catch (e) {
            addLog("error", `Failed to stop test: ${e.message}`);
        }
    };

    const clearHistory = async () => {
        try {
            await axios.delete(`${API}/tests/history/clear`);
            setHistory({ sessions: [], tested_elements: {} });
            addLog("success", "History cleared");
        } catch (e) {
            addLog("error", `Failed to clear history: ${e.message}`);
        }
    };

    const copyJson = (data) => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        addLog("success", "JSON copied to clipboard");
    };

    const deleteSession = async (sessionId) => {
        try {
            await axios.delete(`${API}/tests/sessions/${sessionId}`);
            fetchSessions();
            addLog("success", "Session deleted");
        } catch (e) {
            addLog("error", `Failed to delete session: ${e.message}`);
        }
    };

    const StatusBadge = ({ status }) => {
        const icons = {
            running: <Spinner className="animate-spin" size={14} />,
            completed: <CheckCircle size={14} />,
            stopped: <WarningCircle size={14} />,
            error: <XCircle size={14} />,
            pending: <ClockCountdown size={14} />
        };

        return (
            <span className={`status-indicator ${status}`} data-testid={`status-badge-${status}`}>
                {icons[status]} {status}
            </span>
        );
    };

    return (
        <div className="app-container">
            {/* Sidebar */}
            <aside className="sidebar" data-testid="sidebar">
                <div className="sidebar-header">
                    <h1 className="text-xl font-black tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>
                        QA CRAWLER
                    </h1>
                    <p className="text-xs text-zinc-500 mt-1 uppercase tracking-widest">
                        Bot de Test Automatisé
                    </p>
                </div>
                <nav className="sidebar-nav">
                    <div 
                        className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                        onClick={() => setActiveTab('dashboard')}
                        data-testid="nav-dashboard"
                    >
                        <Gear size={20} weight="bold" />
                        Dashboard
                    </div>
                    <div 
                        className={`nav-item ${activeTab === 'bugs' ? 'active' : ''}`}
                        onClick={() => setActiveTab('bugs')}
                        data-testid="nav-bugs"
                    >
                        <Bug size={20} weight="bold" />
                        Bugs ({bugs.length})
                    </div>
                    <div 
                        className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                        data-testid="nav-history"
                    >
                        <ListBullets size={20} weight="bold" />
                        Historique
                    </div>
                </nav>
                
                {/* Status panel */}
                <div className="p-4 border-t border-zinc-200">
                    <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Status</div>
                    <StatusBadge status={isRunning ? "running" : currentSession?.status || "pending"} />
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {activeTab === 'dashboard' && (
                    <div className="space-y-6" data-testid="dashboard-view">
                        {/* Stats Grid */}
                        <div className="control-grid">
                            <div className="stat-card" data-testid="stat-urls">
                                <div className="stat-label">URLs Scannées</div>
                                <div className="stat-value brand">{stats.urls_scanned}</div>
                            </div>
                            <div className="stat-card" data-testid="stat-elements">
                                <div className="stat-label">Éléments Trouvés</div>
                                <div className="stat-value">{stats.elements_found}</div>
                            </div>
                            <div className="stat-card" data-testid="stat-forms">
                                <div className="stat-label">Formulaires</div>
                                <div className="stat-value">{stats.forms_found}</div>
                            </div>
                            <div className="stat-card" data-testid="stat-bugs">
                                <div className="stat-label">Bugs Trouvés</div>
                                <div className="stat-value error">{stats.bugs_found}</div>
                            </div>
                        </div>

                        {/* Config + Logs Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                            {/* Configuration Panel */}
                            <div className="config-panel" data-testid="config-panel">
                                <h2 className="panel-title">Configuration</h2>
                                
                                <div className="input-group">
                                    <label className="input-label">URL du Site à Tester</label>
                                    <Input
                                        type="url"
                                        placeholder="https://votre-site.com"
                                        value={targetUrl}
                                        onChange={(e) => setTargetUrl(e.target.value)}
                                        className="input-field rounded-none"
                                        disabled={isRunning}
                                        data-testid="input-target-url"
                                    />
                                </div>

                                <div className="input-group">
                                    <div className="checkbox-wrapper">
                                        <Checkbox
                                            id="fillForms"
                                            checked={fillForms}
                                            onCheckedChange={setFillForms}
                                            disabled={isRunning}
                                            data-testid="checkbox-fill-forms"
                                        />
                                        <label htmlFor="fillForms" className="text-sm font-medium cursor-pointer">
                                            Remplir automatiquement les formulaires
                                        </label>
                                    </div>
                                </div>

                                <div className="input-group">
                                    <label className="input-label">Identifiants de Connexion (optionnel)</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Input
                                            type="email"
                                            placeholder="Email"
                                            value={loginEmail}
                                            onChange={(e) => setLoginEmail(e.target.value)}
                                            className="input-field rounded-none"
                                            disabled={isRunning}
                                            data-testid="input-login-email"
                                        />
                                        <Input
                                            type="password"
                                            placeholder="Mot de passe"
                                            value={loginPassword}
                                            onChange={(e) => setLoginPassword(e.target.value)}
                                            className="input-field rounded-none"
                                            disabled={isRunning}
                                            data-testid="input-login-password"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2 mt-6">
                                    {!isRunning ? (
                                        <Button 
                                            onClick={startTest}
                                            className="btn btn-primary rounded-none flex-1"
                                            disabled={!targetUrl}
                                            data-testid="btn-start-test"
                                        >
                                            <Play size={18} weight="bold" />
                                            Démarrer le Test
                                        </Button>
                                    ) : (
                                        <Button 
                                            onClick={stopTest}
                                            className="btn btn-danger rounded-none flex-1"
                                            data-testid="btn-stop-test"
                                        >
                                            <Stop size={18} weight="bold" />
                                            Arrêter
                                        </Button>
                                    )}
                                    <Button
                                        onClick={() => {
                                            fetchTestStatus();
                                            fetchSessions();
                                        }}
                                        className="btn btn-secondary rounded-none"
                                        data-testid="btn-refresh"
                                    >
                                        <ArrowClockwise size={18} weight="bold" />
                                    </Button>
                                </div>
                            </div>

                            {/* Activity Log */}
                            <div className="config-panel" data-testid="activity-log-panel">
                                <h2 className="panel-title">Journal d'Activité</h2>
                                <ScrollArea className="h-[300px]">
                                    <div className="activity-log">
                                        {logs.length === 0 ? (
                                            <div className="text-zinc-500">En attente de démarrage...</div>
                                        ) : (
                                            logs.map((log, i) => (
                                                <div key={i} className="log-entry">
                                                    <span className="log-time">[{log.timestamp}]</span>
                                                    <span className={`log-message ${log.type}`}>{log.message}</span>
                                                </div>
                                            ))
                                        )}
                                        <div ref={logsEndRef} />
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>

                        {/* Recent Bugs Preview */}
                        {bugs.length > 0 && (
                            <div className="config-panel" data-testid="recent-bugs-panel">
                                <h2 className="panel-title">Derniers Bugs Détectés</h2>
                                <div className="space-y-0">
                                    {bugs.slice(-3).map((bug, i) => (
                                        <div key={bug.id || i} className="bug-item" data-testid={`bug-item-${i}`}>
                                            <div className="bug-header">
                                                <span className="bug-type">{bug.type}</span>
                                                <span className={`bug-severity ${bug.severity}`}>{bug.severity}</span>
                                            </div>
                                            <div className="bug-message">{bug.message}</div>
                                            <div className="bug-url">{bug.url}</div>
                                            {bug.screenshot && (
                                                <div className="mt-2 border border-zinc-300">
                                                    <img 
                                                        src={`${BACKEND_URL}${bug.screenshot}`}
                                                        alt={`Screenshot bug ${bug.type}`}
                                                        className="w-full max-h-[200px] object-contain bg-zinc-100"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {bugs.length > 3 && (
                                    <Button 
                                        onClick={() => setActiveTab('bugs')}
                                        className="btn btn-secondary rounded-none mt-4 w-full"
                                        data-testid="btn-view-all-bugs"
                                    >
                                        Voir tous les bugs ({bugs.length})
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'bugs' && (
                    <div className="space-y-6" data-testid="bugs-view">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>
                                BUGS DÉTECTÉS
                            </h2>
                            <span className="status-indicator error">
                                <Bug size={14} /> {bugs.length} bugs
                            </span>
                        </div>

                        {bugs.length === 0 ? (
                            <div className="empty-state">
                                <CheckCircle size={48} className="empty-state-icon" />
                                <p className="empty-state-text">Aucun bug détecté pour le moment</p>
                            </div>
                        ) : (
                            <div className="space-y-0">
                                {bugs.map((bug, i) => (
                                    <div key={bug.id || i} className="bug-item" data-testid={`bug-list-item-${i}`}>
                                        <div className="bug-header">
                                            <span className="bug-type">{bug.type}</span>
                                            <span className={`bug-severity ${bug.severity}`}>{bug.severity}</span>
                                        </div>
                                        <div className="bug-message">{bug.message}</div>
                                        <div className="bug-url">
                                            <Link size={12} className="inline mr-1" />
                                            {bug.url}
                                        </div>
                                        {bug.selector && (
                                            <div className="mt-2 p-2 bg-zinc-100 font-mono text-xs overflow-x-auto">
                                                {bug.selector}
                                            </div>
                                        )}
                                        {bug.screenshot && (
                                            <div className="mt-3 border border-zinc-300">
                                                <div className="bg-zinc-900 text-white text-xs px-3 py-2 font-mono uppercase tracking-wider">
                                                    Screenshot du Bug
                                                </div>
                                                <img 
                                                    src={`${BACKEND_URL}${bug.screenshot}`}
                                                    alt={`Screenshot bug ${bug.type}`}
                                                    className="w-full max-h-[400px] object-contain bg-zinc-100"
                                                    data-testid={`bug-screenshot-${i}`}
                                                />
                                            </div>
                                        )}
                                        <div className="text-xs text-zinc-400 mt-2 font-mono">
                                            {bug.timestamp}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="space-y-6" data-testid="history-view">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>
                                HISTORIQUE DES TESTS
                            </h2>
                            <div className="flex gap-2">
                                <Button
                                    onClick={clearHistory}
                                    className="btn btn-secondary rounded-none"
                                    data-testid="btn-clear-history"
                                >
                                    <Trash size={16} />
                                    Effacer
                                </Button>
                                <Button
                                    onClick={() => copyJson(history)}
                                    className="btn btn-secondary rounded-none"
                                    data-testid="btn-copy-history"
                                >
                                    <Copy size={16} />
                                    Copier JSON
                                </Button>
                            </div>
                        </div>

                        <Tabs defaultValue="sessions" className="w-full">
                            <TabsList className="rounded-none border border-zinc-200 bg-white p-1">
                                <TabsTrigger 
                                    value="sessions" 
                                    className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white"
                                    data-testid="tab-sessions"
                                >
                                    Sessions ({sessions.length})
                                </TabsTrigger>
                                <TabsTrigger 
                                    value="elements" 
                                    className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white"
                                    data-testid="tab-elements"
                                >
                                    Éléments Testés ({Object.keys(history.tested_elements || {}).length})
                                </TabsTrigger>
                                <TabsTrigger 
                                    value="json" 
                                    className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white"
                                    data-testid="tab-json"
                                >
                                    JSON Brut
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="sessions" className="mt-4">
                                {sessions.length === 0 ? (
                                    <div className="empty-state">
                                        <Folder size={48} className="empty-state-icon" />
                                        <p className="empty-state-text">Aucune session enregistrée</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="history-table" data-testid="sessions-table">
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>URL</th>
                                                    <th>Status</th>
                                                    <th>URLs</th>
                                                    <th>Forms</th>
                                                    <th>Bugs</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sessions.map((session, i) => (
                                                    <tr key={session.id} data-testid={`session-row-${i}`}>
                                                        <td>{new Date(session.started_at).toLocaleString('fr-FR')}</td>
                                                        <td className="max-w-[200px] truncate">{session.target_url}</td>
                                                        <td><StatusBadge status={session.status} /></td>
                                                        <td>{session.urls_scanned}</td>
                                                        <td>{session.forms_found}</td>
                                                        <td className={session.bugs_found > 0 ? 'text-red-500 font-bold' : ''}>
                                                            {session.bugs_found}
                                                        </td>
                                                        <td>
                                                            <Button
                                                                onClick={() => deleteSession(session.id)}
                                                                className="btn btn-secondary rounded-none text-xs px-2 py-1"
                                                                data-testid={`btn-delete-session-${i}`}
                                                            >
                                                                <Trash size={14} />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="elements" className="mt-4">
                                <ScrollArea className="h-[400px]">
                                    <div className="json-viewer p-4 rounded-none">
                                        {Object.keys(history.tested_elements || {}).length === 0 ? (
                                            <div className="text-zinc-500">Aucun élément testé</div>
                                        ) : (
                                            Object.entries(history.tested_elements || {}).map(([key, timestamp], i) => (
                                                <div key={i} className="mb-2 pb-2 border-b border-zinc-800">
                                                    <div className="text-blue-400 break-all">{key}</div>
                                                    <div className="text-zinc-500 text-xs mt-1">Testé: {timestamp}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            <TabsContent value="json" className="mt-4">
                                <div className="relative">
                                    <Button
                                        onClick={() => copyJson(history)}
                                        className="absolute top-2 right-2 btn btn-secondary rounded-none text-xs z-10"
                                        data-testid="btn-copy-json"
                                    >
                                        <Copy size={14} />
                                    </Button>
                                    <ScrollArea className="h-[400px]">
                                        <pre className="json-viewer p-4 rounded-none whitespace-pre-wrap break-all">
                                            {JSON.stringify(history, null, 2)}
                                        </pre>
                                    </ScrollArea>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
