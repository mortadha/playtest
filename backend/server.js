const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 8001;

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const TESTS_FILE = path.join(DATA_DIR, 'tests.json');
const SCENARIOS_FILE = path.join(DATA_DIR, 'scenarios.json');

// Create directories
[DATA_DIR, SCREENSHOTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize JSON files
if (!fs.existsSync(TESTS_FILE)) fs.writeFileSync(TESTS_FILE, JSON.stringify({ sessions: [] }));
if (!fs.existsSync(SCENARIOS_FILE)) fs.writeFileSync(SCENARIOS_FILE, JSON.stringify({ scenarios: [] }));

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api/screenshots', express.static(SCREENSHOTS_DIR));

// Helper functions
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Global state
let currentTest = { running: false, sessionId: null, shouldStop: false };
let wsClients = [];

// Broadcast to all WebSocket clients
const broadcast = (data) => {
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

// API Routes
app.get('/api', (req, res) => {
  res.json({ message: 'QA Crawler Bot API - Node.js' });
});

// Get all scenarios
app.get('/api/scenarios', (req, res) => {
  const data = readJSON(SCENARIOS_FILE);
  res.json(data.scenarios);
});

// Create scenario
app.post('/api/scenarios', (req, res) => {
  const { name, targetUrl, steps } = req.body;
  const scenario = {
    id: uuidv4(),
    name,
    targetUrl,
    steps: steps || [],
    createdAt: new Date().toISOString()
  };
  
  const data = readJSON(SCENARIOS_FILE);
  data.scenarios.unshift(scenario);
  writeJSON(SCENARIOS_FILE, data);
  
  res.json(scenario);
});

// Update scenario
app.put('/api/scenarios/:id', (req, res) => {
  const { id } = req.params;
  const { name, targetUrl, steps } = req.body;
  
  const data = readJSON(SCENARIOS_FILE);
  const index = data.scenarios.findIndex(s => s.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Scenario not found' });
  }
  
  data.scenarios[index] = { ...data.scenarios[index], name, targetUrl, steps };
  writeJSON(SCENARIOS_FILE, data);
  
  res.json(data.scenarios[index]);
});

// Delete scenario
app.delete('/api/scenarios/:id', (req, res) => {
  const { id } = req.params;
  const data = readJSON(SCENARIOS_FILE);
  data.scenarios = data.scenarios.filter(s => s.id !== id);
  writeJSON(SCENARIOS_FILE, data);
  res.json({ status: 'deleted' });
});

// Get test sessions
app.get('/api/tests/sessions', (req, res) => {
  const data = readJSON(TESTS_FILE);
  res.json(data.sessions);
});

// Get test status
app.get('/api/tests/status', (req, res) => {
  res.json({
    running: currentTest.running,
    sessionId: currentTest.sessionId
  });
});

// Start test
app.post('/api/tests/start', async (req, res) => {
  if (currentTest.running) {
    return res.status(400).json({ error: 'A test is already running' });
  }
  
  const { scenarioId, targetUrl, steps, fillForms = true, formData = {} } = req.body;
  
  const session = {
    id: uuidv4(),
    scenarioId,
    targetUrl,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    steps: [],
    bugs: [],
    formData: formData
  };
  
  // Save session
  const data = readJSON(TESTS_FILE);
  data.sessions.unshift(session);
  writeJSON(TESTS_FILE, data);
  
  currentTest.running = true;
  currentTest.sessionId = session.id;
  currentTest.shouldStop = false;
  
  res.json({ sessionId: session.id, status: 'started' });
  
  // Run test in background
  runTest(session.id, targetUrl, steps || [], fillForms, formData);
});

// Stop test
app.post('/api/tests/stop', (req, res) => {
  if (!currentTest.running) {
    return res.status(400).json({ error: 'No test running' });
  }
  currentTest.shouldStop = true;
  res.json({ status: 'stopping' });
});

// Delete session
app.delete('/api/tests/sessions/:id', (req, res) => {
  const { id } = req.params;
  const data = readJSON(TESTS_FILE);
  data.sessions = data.sessions.filter(s => s.id !== id);
  writeJSON(TESTS_FILE, data);
  res.json({ status: 'deleted' });
});

// Run Playwright test
async function runTest(sessionId, targetUrl, scenarioSteps, fillForms = true, formData = {}) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    
    // Error tracking
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push({ type: 'console_error', message: msg.text(), url: page.url() });
      }
    });
    page.on('pageerror', error => {
      errors.push({ type: 'page_error', message: error.message, url: page.url() });
    });
    
    broadcast({ type: 'status', status: 'running' });
    
    // Navigate to target URL
    broadcast({ type: 'progress', message: `Navigating to ${targetUrl}` });
    
    try {
      await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
    } catch (e) {
      if (e.message.includes('Timeout')) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw e;
      }
    }
    
    // Capture initial screenshot
    await captureStep(page, sessionId, 'visit', `Visited: ${targetUrl}`, targetUrl);
    
    // Execute scenario steps if provided
    if (scenarioSteps.length > 0) {
      for (const step of scenarioSteps) {
        if (currentTest.shouldStop) break;
        
        try {
          await executeStep(page, step, sessionId, formData);
        } catch (e) {
          await addBug(sessionId, 'step_error', e.message, page.url());
        }
      }
    } else {
      // Auto-explore mode
      await autoExplore(page, sessionId, targetUrl, fillForms, formData);
    }
    
    // Record any errors as bugs
    for (const error of errors) {
      await addBug(sessionId, error.type, error.message, error.url);
    }
    
    // Complete test
    const data = readJSON(TESTS_FILE);
    const session = data.sessions.find(s => s.id === sessionId);
    if (session) {
      session.status = currentTest.shouldStop ? 'stopped' : 'completed';
      session.endedAt = new Date().toISOString();
      writeJSON(TESTS_FILE, data);
    }
    
    broadcast({ type: 'completed', status: session?.status || 'completed' });
    
  } catch (e) {
    console.error('Test error:', e);
    broadcast({ type: 'error', message: e.message });
    
    const data = readJSON(TESTS_FILE);
    const session = data.sessions.find(s => s.id === sessionId);
    if (session) {
      session.status = 'error';
      session.endedAt = new Date().toISOString();
      writeJSON(TESTS_FILE, data);
    }
  } finally {
    await browser.close();
    currentTest.running = false;
    currentTest.sessionId = null;
  }
}

// Execute a single step
async function executeStep(page, step, sessionId, formData = {}) {
  broadcast({ type: 'progress', message: `Executing: ${step.action} - ${step.description || ''}` });
  
  switch (step.action) {
    case 'click':
      await page.click(step.selector, { timeout: 10000 });
      await page.waitForTimeout(1000);
      await captureStep(page, sessionId, 'click', `Clicked: ${step.selector}`, page.url());
      break;
      
    case 'fill':
      // Use formData value if available, otherwise use step value
      let fillValue = step.value || '';
      const selectorLower = step.selector.toLowerCase();
      if (selectorLower.includes('email') && formData.email) fillValue = formData.email;
      else if (selectorLower.includes('password') && formData.password) fillValue = formData.password;
      else if (selectorLower.includes('name') && formData.name) fillValue = formData.name;
      else if (selectorLower.includes('phone') && formData.phone) fillValue = formData.phone;
      
      await page.fill(step.selector, fillValue);
      await captureStep(page, sessionId, 'fill', `Filled: ${step.selector} = ${fillValue}`, page.url());
      break;
      
    case 'select':
      await page.selectOption(step.selector, step.value);
      await captureStep(page, sessionId, 'select', `Selected: ${step.value} in ${step.selector}`, page.url());
      break;
      
    case 'check':
      await page.check(step.selector);
      await captureStep(page, sessionId, 'check', `Checked: ${step.selector}`, page.url());
      break;
      
    case 'wait':
      await page.waitForTimeout(step.duration || 1000);
      break;
      
    case 'navigate':
      await page.goto(step.url, { waitUntil: 'load', timeout: 30000 });
      await captureStep(page, sessionId, 'navigate', `Navigated to: ${step.url}`, step.url);
      break;
      
    case 'screenshot':
      await captureStep(page, sessionId, 'screenshot', step.description || 'Manual screenshot', page.url());
      break;
  }
}

// Auto-explore mode
async function autoExplore(page, sessionId, baseUrl, fillForms = true, formData = {}) {
  const visitedUrls = new Set([baseUrl]);
  const urlsToVisit = [];
  
  // Find buttons and click them
  const buttons = await page.$$('button, [role="button"], input[type="submit"]');
  for (const button of buttons.slice(0, 5)) {
    if (currentTest.shouldStop) break;
    
    try {
      const isVisible = await button.isVisible();
      const isEnabled = await button.isEnabled();
      
      if (isVisible && isEnabled) {
        const text = await button.innerText().catch(() => '');
        if (!['logout', 'déconnexion', 'delete', 'supprimer'].some(t => text.toLowerCase().includes(t))) {
          broadcast({ type: 'progress', message: `Clicking button: ${text.slice(0, 30)}` });
          await button.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          await captureStep(page, sessionId, 'click', `Clicked button: ${text.slice(0, 50)}`, page.url());
        }
      }
    } catch (e) {}
  }
  
  // Find and fill forms
  if (fillForms) {
    const forms = await page.$$('form');
    for (const form of forms.slice(0, 3)) {
      if (currentTest.shouldStop) break;
      
      try {
        broadcast({ type: 'progress', message: 'Filling form...' });
        
        const inputs = await form.$$('input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="search"], input[type="number"], textarea');
        for (const input of inputs) {
          const type = await input.getAttribute('type') || 'text';
          const name = (await input.getAttribute('name') || '').toLowerCase();
          const placeholder = (await input.getAttribute('placeholder') || '').toLowerCase();
          const id = (await input.getAttribute('id') || '').toLowerCase();
          const fieldHint = name + placeholder + id;
          
          let value = formData.custom || 'Test Value';
          
          // Match field to formData
          if (type === 'email' || fieldHint.includes('email') || fieldHint.includes('mail')) {
            value = formData.email || 'test@example.com';
          } else if (type === 'password' || fieldHint.includes('password') || fieldHint.includes('pass')) {
            value = formData.password || 'TestPass123!';
          } else if (fieldHint.includes('phone') || fieldHint.includes('tel') || fieldHint.includes('mobile')) {
            value = formData.phone || '0612345678';
          } else if (fieldHint.includes('name') || fieldHint.includes('nom') || fieldHint.includes('prenom') || fieldHint.includes('firstname') || fieldHint.includes('lastname')) {
            value = formData.name || 'Test User';
          } else if (fieldHint.includes('address') || fieldHint.includes('adresse') || fieldHint.includes('rue') || fieldHint.includes('street')) {
            value = formData.address || '123 Rue de Test';
          } else if (fieldHint.includes('city') || fieldHint.includes('ville') || fieldHint.includes('town')) {
            value = formData.city || 'Paris';
          } else if (fieldHint.includes('search') || fieldHint.includes('query') || fieldHint.includes('recherche')) {
            value = formData.search || 'test query';
          } else if (fieldHint.includes('message') || fieldHint.includes('comment') || fieldHint.includes('description') || fieldHint.includes('text')) {
            value = formData.message || 'Ceci est un message de test automatique.';
          } else if (type === 'number') {
            value = '42';
          }
          
          await input.fill(value).catch(() => {});
          broadcast({ type: 'progress', message: `Filled: ${name || type} = ${value.slice(0, 20)}...` });
        }
        
        // Handle select dropdowns
        const selects = await form.$$('select');
        for (const select of selects) {
          try {
            const options = await select.$$('option');
            if (options.length > 1) {
              const optionValue = await options[1].getAttribute('value');
              if (optionValue) {
                await select.selectOption(optionValue);
              }
            }
          } catch (e) {}
        }
        
        // Handle checkboxes
        const checkboxes = await form.$$('input[type="checkbox"]');
        for (const checkbox of checkboxes) {
          try {
            const isChecked = await checkbox.isChecked();
            if (!isChecked) {
              await checkbox.check();
            }
          } catch (e) {}
        }
        
        await captureStep(page, sessionId, 'fill_form', 'Filled form fields', page.url());
        
        const submitBtn = await form.$('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          await submitBtn.click().catch(() => {});
          await page.waitForTimeout(2000);
          await captureStep(page, sessionId, 'submit', 'Submitted form', page.url());
        }
      } catch (e) {}
    }
  }
  
  // Find links and visit them
  const links = await page.$$('a[href]');
  for (const link of links.slice(0, 5)) {
    try {
      const href = await link.getAttribute('href');
      if (href && href.startsWith('/')) {
        const fullUrl = new URL(href, baseUrl).toString();
        if (!visitedUrls.has(fullUrl) && fullUrl.includes(new URL(baseUrl).hostname)) {
          urlsToVisit.push(fullUrl);
        }
      }
    } catch (e) {}
  }
  
  // Visit found links
  for (const url of urlsToVisit.slice(0, 3)) {
    if (currentTest.shouldStop) break;
    
    try {
      visitedUrls.add(url);
      broadcast({ type: 'progress', message: `Visiting: ${url}` });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await captureStep(page, sessionId, 'visit', `Visited: ${url}`, url);
    } catch (e) {}
  }
}

// Capture step with screenshot
async function captureStep(page, sessionId, type, description, url) {
  const screenshotId = uuidv4();
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${screenshotId}.png`);
  
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (e) {
    console.error('Screenshot error:', e);
  }
  
  const step = {
    id: uuidv4(),
    type,
    description,
    url,
    screenshot: `/api/screenshots/${screenshotId}.png`,
    timestamp: new Date().toISOString()
  };
  
  const data = readJSON(TESTS_FILE);
  const session = data.sessions.find(s => s.id === sessionId);
  if (session) {
    session.steps.push(step);
    writeJSON(TESTS_FILE, data);
  }
  
  broadcast({ type: 'step', step });
  
  return step;
}

// Add bug
async function addBug(sessionId, type, message, url) {
  const bug = {
    id: uuidv4(),
    type,
    message,
    url,
    timestamp: new Date().toISOString()
  };
  
  const data = readJSON(TESTS_FILE);
  const session = data.sessions.find(s => s.id === sessionId);
  if (session) {
    session.bugs.push(bug);
    writeJSON(TESTS_FILE, data);
  }
  
  broadcast({ type: 'bug', bug });
}

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/api/ws' });

wss.on('connection', (ws) => {
  wsClients.push(ws);
  console.log('WebSocket client connected');
  
  ws.on('close', () => {
    wsClients = wsClients.filter(client => client !== ws);
  });
  
  ws.on('message', (data) => {
    if (data.toString() === 'ping') {
      ws.send('pong');
    }
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`QA Crawler Bot API running on port ${PORT}`);
});
