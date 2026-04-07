const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
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

// Selenium helper: build Chrome driver
async function buildDriver() {
  const options = new chrome.Options();
  options.setChromeBinaryPath('/usr/bin/chromium');
  options.addArguments('--headless=new');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');
  options.addArguments('--disable-gpu');
  options.addArguments('--window-size=1920,1080');
  options.addArguments('--ignore-certificate-errors');
  options.addArguments('--disable-extensions');
  options.addArguments('--disable-web-security');

  const service = new chrome.ServiceBuilder('/usr/bin/chromedriver');

  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .setChromeService(service)
    .build();

  return driver;
}

// Selenium helper: sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API Routes
app.get('/api', (req, res) => {
  res.json({ message: 'QA Crawler Bot API - Node.js + Selenium' });
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

  // Run test in background (catch unhandled errors)
  runTest(session.id, targetUrl, steps || [], fillForms, formData).catch(err => {
    console.error('Unhandled test error:', err.message);
    currentTest.running = false;
    currentTest.sessionId = null;
    broadcast({ type: 'error', message: err.message });

    const data = readJSON(TESTS_FILE);
    const s = data.sessions.find(x => x.id === session.id);
    if (s) {
      s.status = 'error';
      s.endedAt = new Date().toISOString();
      writeJSON(TESTS_FILE, data);
    }
  });
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

// Run Selenium test
async function runTest(sessionId, targetUrl, scenarioSteps, fillForms = true, formData = {}) {
  const driver = await buildDriver();

  try {
    // Capture JS errors via browser logs
    broadcast({ type: 'status', status: 'running' });

    // Navigate to target URL
    broadcast({ type: 'progress', message: `Navigation vers ${targetUrl}` });

    await driver.get(targetUrl);
    await sleep(2000);

    // Capture initial screenshot
    await captureStep(driver, sessionId, 'visit', `Visited: ${targetUrl}`, targetUrl);

    // Execute scenario steps if provided
    if (scenarioSteps.length > 0) {
      for (const step of scenarioSteps) {
        if (currentTest.shouldStop) break;

        try {
          await executeStep(driver, step, sessionId, formData);
        } catch (e) {
          const currentUrl = await driver.getCurrentUrl().catch(() => targetUrl);
          await addBug(sessionId, 'step_error', e.message, currentUrl);
        }
      }
    } else {
      // Auto-explore mode
      await autoExplore(driver, sessionId, targetUrl, fillForms, formData);
    }

    // Collect browser console errors
    try {
      const logs = await driver.manage().logs().get('browser');
      for (const entry of logs) {
        if (entry.level.name === 'SEVERE') {
          const currentUrl = await driver.getCurrentUrl().catch(() => targetUrl);
          await addBug(sessionId, 'console_error', entry.message, currentUrl);
        }
      }
    } catch (e) {
      // Some drivers don't support log collection
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
    await driver.quit().catch(() => {});
    currentTest.running = false;
    currentTest.sessionId = null;
  }
}

// Execute a single step with Selenium
async function executeStep(driver, step, sessionId, formData = {}) {
  broadcast({ type: 'progress', message: `Executing: ${step.action} - ${step.description || ''}` });

  switch (step.action) {
    case 'click': {
      const el = await driver.wait(until.elementLocated(By.css(step.selector)), 10000);
      await driver.wait(until.elementIsVisible(el), 5000);
      await el.click();
      await sleep(1000);
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'click', `Clicked: ${step.selector}`, url);
      break;
    }

    case 'fill': {
      let fillValue = step.value || '';
      const selectorLower = step.selector.toLowerCase();
      if (selectorLower.includes('email') && formData.email) fillValue = formData.email;
      else if (selectorLower.includes('password') && formData.password) fillValue = formData.password;
      else if (selectorLower.includes('name') && formData.name) fillValue = formData.name;
      else if (selectorLower.includes('phone') && formData.phone) fillValue = formData.phone;

      const el = await driver.wait(until.elementLocated(By.css(step.selector)), 10000);
      await el.clear();
      await el.sendKeys(fillValue);
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'fill', `Filled: ${step.selector} = ${fillValue}`, url);
      break;
    }

    case 'select': {
      const el = await driver.wait(until.elementLocated(By.css(step.selector)), 10000);
      // Find option by value or visible text
      try {
        const option = await el.findElement(By.css(`option[value="${step.value}"]`));
        await option.click();
      } catch (e) {
        // Try by visible text
        const options = await el.findElements(By.tagName('option'));
        for (const opt of options) {
          const text = await opt.getText();
          if (text.includes(step.value)) {
            await opt.click();
            break;
          }
        }
      }
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'select', `Selected: ${step.value} in ${step.selector}`, url);
      break;
    }

    case 'check': {
      const el = await driver.wait(until.elementLocated(By.css(step.selector)), 10000);
      const isChecked = await el.isSelected();
      if (!isChecked) {
        await el.click();
      }
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'check', `Checked: ${step.selector}`, url);
      break;
    }

    case 'wait': {
      await sleep(step.duration || 1000);
      break;
    }

    case 'navigate': {
      await driver.get(step.url || step.selector);
      await sleep(2000);
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'navigate', `Navigated to: ${url}`, url);
      break;
    }

    case 'screenshot': {
      const url = await driver.getCurrentUrl();
      await captureStep(driver, sessionId, 'screenshot', step.description || 'Manual screenshot', url);
      break;
    }
  }
}

// Auto-explore mode with Selenium
async function autoExplore(driver, sessionId, baseUrl, fillForms = true, formData = {}) {
  const visitedUrls = new Set([baseUrl]);
  const urlsToVisit = [];

  // Find buttons and click them
  try {
    const buttons = await driver.findElements(By.css('button, [role="button"], input[type="submit"]'));
    for (const button of buttons.slice(0, 5)) {
      if (currentTest.shouldStop) break;

      try {
        const isDisplayed = await button.isDisplayed();
        const isEnabled = await button.isEnabled();

        if (isDisplayed && isEnabled) {
          const text = await button.getText().catch(() => '');
          if (!['logout', 'deconnexion', 'delete', 'supprimer'].some(t => text.toLowerCase().includes(t))) {
            broadcast({ type: 'progress', message: `Clicking button: ${text.slice(0, 30)}` });
            await button.click().catch(() => {});
            await sleep(1000);
            const url = await driver.getCurrentUrl();
            await captureStep(driver, sessionId, 'click', `Clicked button: ${text.slice(0, 50)}`, url);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  // Find and fill forms
  if (fillForms) {
    try {
      const forms = await driver.findElements(By.tagName('form'));
      for (const form of forms.slice(0, 3)) {
        if (currentTest.shouldStop) break;

        try {
          broadcast({ type: 'progress', message: 'Filling form...' });

          const inputs = await form.findElements(By.css('input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="search"], input[type="number"], textarea'));
          for (const input of inputs) {
            try {
              const type = await input.getAttribute('type') || 'text';
              const name = (await input.getAttribute('name') || '').toLowerCase();
              const placeholder = (await input.getAttribute('placeholder') || '').toLowerCase();
              const id = (await input.getAttribute('id') || '').toLowerCase();
              const fieldHint = name + placeholder + id;

              let value = formData.custom || 'Test Value';

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

              await input.clear().catch(() => {});
              await input.sendKeys(value).catch(() => {});
              broadcast({ type: 'progress', message: `Filled: ${name || type} = ${value.slice(0, 20)}...` });
            } catch (e) {}
          }

          // Handle select dropdowns
          const selects = await form.findElements(By.tagName('select'));
          for (const select of selects) {
            try {
              const options = await select.findElements(By.tagName('option'));
              if (options.length > 1) {
                await options[1].click();
              }
            } catch (e) {}
          }

          // Handle checkboxes
          const checkboxes = await form.findElements(By.css('input[type="checkbox"]'));
          for (const checkbox of checkboxes) {
            try {
              const isChecked = await checkbox.isSelected();
              if (!isChecked) {
                await checkbox.click();
              }
            } catch (e) {}
          }

          const url = await driver.getCurrentUrl();
          await captureStep(driver, sessionId, 'fill_form', 'Filled form fields', url);

          // Submit
          try {
            const submitBtn = await form.findElement(By.css('button[type="submit"], input[type="submit"]'));
            await submitBtn.click();
            await sleep(2000);
            const urlAfter = await driver.getCurrentUrl();
            await captureStep(driver, sessionId, 'submit', 'Submitted form', urlAfter);
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Find links and visit them
  try {
    const links = await driver.findElements(By.css('a[href]'));
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
  } catch (e) {}

  // Visit found links
  for (const url of urlsToVisit.slice(0, 3)) {
    if (currentTest.shouldStop) break;

    try {
      visitedUrls.add(url);
      broadcast({ type: 'progress', message: `Visiting: ${url}` });
      await driver.get(url);
      await sleep(2000);
      await captureStep(driver, sessionId, 'visit', `Visited: ${url}`, url);
    } catch (e) {}
  }
}

// Capture step with screenshot (Selenium)
async function captureStep(driver, sessionId, type, description, url) {
  const screenshotId = uuidv4();
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${screenshotId}.png`);

  try {
    const image = await driver.takeScreenshot();
    fs.writeFileSync(screenshotPath, image, 'base64');
  } catch (e) {
    console.error('Screenshot error:', e.message);
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
  console.log(`QA Crawler Bot API (Selenium) running on port ${PORT}`);
});
