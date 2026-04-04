import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';

interface Step {
  id: string;
  type: string;
  description: string;
  url: string;
  screenshot: string;
  timestamp: string;
}

interface Bug {
  id: string;
  type: string;
  message: string;
  url: string;
  timestamp: string;
}

interface Session {
  id: string;
  targetUrl: string;
  status: string;
  startedAt: string;
  endedAt: string;
  steps: Step[];
  bugs: Bug[];
  scenarioId?: string;
}

interface Scenario {
  id: string;
  name: string;
  targetUrl: string;
  steps: any[];
  createdAt: string;
}

interface JournalEntry {
  id: number;
  type: 'log' | 'step' | 'bug' | 'status';
  logType?: string;
  message: string;
  step?: Step;
  bug?: Bug;
  timestamp: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, HttpClientModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  private API_URL = 'https://qa-crawler-bot.preview.emergentagent.com/api';
  private WS_URL = 'wss://qa-crawler-bot.preview.emergentagent.com/api/ws';
  private ws: WebSocket | null = null;

  activeTab = 'dashboard';
  targetUrl = '';
  isRunning = false;
  
  // Form fill options
  fillForms = true;
  formData = {
    email: 'test@example.com',
    password: 'TestPass123!',
    name: 'Test User',
    phone: '0612345678',
    address: '123 Rue de Test',
    city: 'Paris',
    search: 'test query',
    message: 'Ceci est un message de test automatique.',
    custom: ''
  };
  
  logs: { type: string; message: string; time: string }[] = [];
  steps: Step[] = [];
  bugs: Bug[] = [];
  sessions: Session[] = [];
  scenarios: Scenario[] = [];
  
  // Scenario builder
  newScenarioName = '';
  newScenarioUrl = '';
  newScenarioSteps: any[] = [];
  newStepAction = 'click';
  newStepSelector = '';
  newStepValue = '';
  newStepDescription = '';
  
  // Selected session for viewing
  selectedSession: Session | null = null;
  currentScenarioId: string | null = null;
  
  // Journal - real-time activity log
  journalEntries: JournalEntry[] = [];
  journalEntryCounter = 0;
  activeScenario: Scenario | null = null;
  journalExpanded: { [key: number]: boolean } = {};
  testProgress = 0;
  totalScenarioSteps = 0;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.connectWebSocket();
    this.loadSessions();
    this.loadScenarios();
  }

  ngOnDestroy() {
    if (this.ws) {
      this.ws.close();
    }
  }

  connectWebSocket() {
    this.ws = new WebSocket(this.WS_URL);
    
    this.ws.onopen = () => {
      this.addLog('info', 'Connected to server');
      this.cdr.detectChanges();
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'status':
          this.isRunning = data.status === 'running';
          this.addLog('info', `Test status: ${data.status}`);
          this.addJournalEntry('status', 'info', `Statut du test: ${data.status}`);
          break;
        case 'progress':
          this.addLog('info', data.message);
          this.addJournalEntry('log', 'info', data.message);
          break;
        case 'step':
          this.steps.push(data.step);
          this.testProgress++;
          this.addLog('success', `Step: ${data.step.description}`);
          this.addJournalEntry('step', 'success', data.step.description, data.step);
          break;
        case 'bug':
          this.bugs.push(data.bug);
          this.addLog('error', `BUG: ${data.bug.type} - ${data.bug.message}`);
          this.addJournalEntry('bug', 'error', `${data.bug.type}: ${data.bug.message}`, undefined, data.bug);
          break;
        case 'completed':
          this.isRunning = false;
          this.addLog('success', `Test ${data.status}`);
          this.addJournalEntry('status', data.status === 'completed' ? 'success' : 'warning', `Test terminé: ${data.status}`);
          this.loadSessions();
          break;
        case 'error':
          this.isRunning = false;
          this.addLog('error', `Error: ${data.message}`);
          this.addJournalEntry('bug', 'error', `Erreur: ${data.message}`);
          break;
      }
      
      this.cdr.detectChanges();
    };
    
    this.ws.onclose = () => {
      this.addLog('info', 'Disconnected from server');
      this.cdr.detectChanges();
      setTimeout(() => this.connectWebSocket(), 3000);
    };
  }

  addLog(type: string, message: string) {
    const time = new Date().toLocaleTimeString('fr-FR');
    this.logs.push({ type, message, time });
    if (this.logs.length > 100) {
      this.logs.shift();
    }
  }

  addJournalEntry(type: 'log' | 'step' | 'bug' | 'status', logType: string, message: string, step?: Step, bug?: Bug) {
    this.journalEntryCounter++;
    this.journalEntries.push({
      id: this.journalEntryCounter,
      type,
      logType,
      message,
      step,
      bug,
      timestamp: new Date().toISOString()
    });
  }

  toggleScreenshot(entryId: number) {
    this.journalExpanded[entryId] = !this.journalExpanded[entryId];
  }

  loadSessions() {
    this.http.get<Session[]>(`${this.API_URL}/tests/sessions`).subscribe({
      next: (sessions) => {
        this.sessions = sessions;
        if (sessions.length > 0 && sessions[0].steps) {
          this.steps = sessions[0].steps;
        }
      },
      error: (err) => console.error('Failed to load sessions:', err)
    });
  }

  loadScenarios() {
    this.http.get<Scenario[]>(`${this.API_URL}/scenarios`).subscribe({
      next: (scenarios) => this.scenarios = scenarios,
      error: (err) => console.error('Failed to load scenarios:', err)
    });
  }

  startTest(scenarioId?: string) {
    if (this.isRunning) {
      this.addLog('error', 'Un test est déjà en cours');
      return;
    }
    
    const scenario = scenarioId ? this.scenarios.find(s => s.id === scenarioId) : null;
    
    if (!scenario && !this.targetUrl) {
      this.addLog('error', 'Please enter a URL');
      return;
    }
    
    // Set running immediately
    this.isRunning = true;
    this.logs = [];
    this.steps = [];
    this.bugs = [];
    this.journalEntries = [];
    this.journalEntryCounter = 0;
    this.journalExpanded = {};
    this.testProgress = 0;
    this.currentScenarioId = scenarioId || null;
    this.activeScenario = scenario || null;
    this.totalScenarioSteps = scenario ? scenario.steps.length : 0;
    
    // Switch to journal tab
    this.activeTab = 'journal';
    
    const body = {
      targetUrl: scenario?.targetUrl || this.targetUrl,
      scenarioId,
      steps: scenario?.steps || [],
      fillForms: this.fillForms,
      formData: this.formData
    };
    
    this.addLog('info', 'Starting test...');
    this.addJournalEntry('status', 'info', `Démarrage du test sur ${body.targetUrl}`);
    
    this.http.post(`${this.API_URL}/tests/start`, body).subscribe({
      next: () => {
        this.addLog('success', 'Test started');
      },
      error: (err) => {
        this.isRunning = false;
        this.currentScenarioId = null;
        this.activeScenario = null;
        this.addLog('error', `Failed to start: ${err.error?.error || err.message}`);
        this.addJournalEntry('bug', 'error', `Échec du démarrage: ${err.error?.error || err.message}`);
      }
    });
  }

  stopTest() {
    this.http.post(`${this.API_URL}/tests/stop`, {}).subscribe({
      next: () => this.addLog('info', 'Stopping test...'),
      error: (err) => this.addLog('error', `Failed to stop: ${err.message}`)
    });
  }

  viewSession(session: Session) {
    this.selectedSession = session;
    this.steps = session.steps || [];
    this.bugs = session.bugs || [];
    
    // Populate journal from session data
    this.journalEntries = [];
    this.journalEntryCounter = 0;
    this.journalExpanded = {};
    this.testProgress = 0;
    
    // Find scenario if it exists
    this.activeScenario = session.scenarioId ? this.scenarios.find(s => s.id === session.scenarioId) || null : null;
    this.totalScenarioSteps = this.activeScenario ? this.activeScenario.steps.length : 0;
    
    // Rebuild journal from session steps and bugs
    const allEvents: { time: string; type: 'step' | 'bug'; data: any }[] = [];
    
    for (const step of (session.steps || [])) {
      allEvents.push({ time: step.timestamp, type: 'step', data: step });
    }
    for (const bug of (session.bugs || [])) {
      allEvents.push({ time: bug.timestamp, type: 'bug', data: bug });
    }
    
    allEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    
    // Add start entry
    this.addJournalEntry('status', 'info', `Session démarrée sur ${session.targetUrl}`);
    
    for (const ev of allEvents) {
      if (ev.type === 'step') {
        this.testProgress++;
        this.addJournalEntry('step', 'success', ev.data.description, ev.data);
      } else {
        this.addJournalEntry('bug', 'error', `${ev.data.type}: ${ev.data.message}`, undefined, ev.data);
      }
    }
    
    // Add end entry
    this.addJournalEntry('status', session.status === 'completed' ? 'success' : 'warning', `Test terminé: ${session.status}`);
    
    this.activeTab = 'journal';
  }

  deleteSession(id: string) {
    this.http.delete(`${this.API_URL}/tests/sessions/${id}`).subscribe({
      next: () => {
        this.sessions = this.sessions.filter(s => s.id !== id);
        this.addLog('success', 'Session deleted');
      },
      error: (err) => this.addLog('error', `Failed to delete: ${err.message}`)
    });
  }

  // Scenario management
  addStepToScenario() {
    if (!this.newStepSelector && this.newStepAction !== 'wait' && this.newStepAction !== 'screenshot') {
      return;
    }
    
    this.newScenarioSteps.push({
      action: this.newStepAction,
      selector: this.newStepSelector,
      value: this.newStepValue,
      description: this.newStepDescription,
      duration: this.newStepAction === 'wait' ? parseInt(this.newStepValue) || 1000 : undefined
    });
    
    this.newStepSelector = '';
    this.newStepValue = '';
    this.newStepDescription = '';
  }

  removeStepFromScenario(index: number) {
    this.newScenarioSteps.splice(index, 1);
  }

  saveScenario() {
    if (!this.newScenarioName || !this.newScenarioUrl) {
      this.addLog('error', 'Please enter scenario name and URL');
      return;
    }
    
    const body = {
      name: this.newScenarioName,
      targetUrl: this.newScenarioUrl,
      steps: this.newScenarioSteps
    };
    
    this.http.post<Scenario>(`${this.API_URL}/scenarios`, body).subscribe({
      next: (scenario) => {
        this.scenarios.unshift(scenario);
        this.newScenarioName = '';
        this.newScenarioUrl = '';
        this.newScenarioSteps = [];
        this.addLog('success', 'Scenario saved');
      },
      error: (err) => this.addLog('error', `Failed to save: ${err.message}`)
    });
  }

  deleteScenario(id: string) {
    this.http.delete(`${this.API_URL}/scenarios/${id}`).subscribe({
      next: () => {
        this.scenarios = this.scenarios.filter(s => s.id !== id);
        this.addLog('success', 'Scenario deleted');
      },
      error: (err) => this.addLog('error', `Failed to delete: ${err.message}`)
    });
  }

  getStepIcon(type: string): string {
    const icons: Record<string, string> = {
      visit: '🔍',
      click: '🖱️',
      fill: '✏️',
      fill_form: '📝',
      submit: '✈️',
      select: '📋',
      check: '☑️',
      navigate: '🧭',
      screenshot: '📸'
    };
    return icons[type] || '⚡';
  }

  getStepLabel(type: string): string {
    const labels: Record<string, string> = {
      visit: 'VISITE',
      click: 'CLIC',
      fill: 'SAISIE',
      fill_form: 'FORMULAIRE',
      submit: 'SOUMISSION',
      select: 'SÉLECTION',
      check: 'CASE',
      navigate: 'NAVIGATION',
      screenshot: 'CAPTURE'
    };
    return labels[type] || type.toUpperCase();
  }
}
