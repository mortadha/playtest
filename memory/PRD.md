# QA Crawler Bot - PRD

## Original Problem Statement
Application de test automatise qui explore un site web, clique partout, remplit les formulaires automatiquement et s'arrete quand elle trouve un bug. Dashboard web pour controler les tests. Stockage JSON des tests pour eviter les doublons.

## Technical Stack (CURRENT)
- **Backend**: Node.js, Express, Selenium WebDriver, WebSocket
- **Frontend**: Angular 21 (Standalone Components, zone-less), static build served via http-server
- **Browser**: Chromium + ChromeDriver (headless)
- **Storage**: JSON files (scenarios.json, tests.json) - NO DATABASE
- **Design**: Swiss/Brutalist (Chivo, IBM Plex Sans, JetBrains Mono)

## What's Been Implemented

### Phase 1 - Core (Done)
- Backend Node.js/Express avec Selenium WebDriver
- Frontend Angular 21 avec design Swiss/Brutalist
- WebSocket pour updates temps reel
- Stockage JSON des sessions et scenarios
- Detection erreurs console JavaScript (via browser logs)
- Navigation automatique entre pages
- Clic sur boutons
- Remplissage formulaires (text, email, password, select, checkbox)
- Creation de scenarios avec etapes personnalisees
- Execution de scenarios avec captures d'ecran par etape
- Historique des sessions de test

### Phase 2 - UX (Done)
- Desactivation auto-refresh Angular (build statique)
- Suppression de "Test Rapide" du dashboard
- Fix bug double-clic sur "Executer"

### Phase 3 - Journal d'Activite (Done)
- Onglet "Journal" avec vue split: Scenario Prevu + Execution en Direct
- Badge LIVE, bouton STOP, timeline temps reel
- Screenshots depliables par etape
- ChangeDetectorRef pour Angular zone-less
- URLs dynamiques (local + preview)

### Phase 4 - Migration Selenium (Done)
- Remplacement complet de Playwright par Selenium WebDriver
- Chrome Options: headless, no-sandbox, disable-dev-shm
- ServiceBuilder pointant vers /usr/bin/chromedriver
- ChromeBinaryPath vers /usr/bin/chromium
- Protection crash serveur (runTest().catch)
- Meme API, meme comportement, meme frontend

## Key Architecture

### Files
- `/app/backend/server.js` - API + Selenium + WebSocket
- `/app/frontend/src/app/app.ts` - Angular component logic
- `/app/frontend/src/app/app.html` - Template
- `/app/frontend/src/app/app.scss` - Styles

### Data
- `/app/backend/data/scenarios.json` - Scenarios crees
- `/app/backend/data/tests.json` - Historique des sessions

### IMPORTANT
- Angular 21 zone-less: utiliser ChangeDetectorRef.detectChanges()
- URLs API/WS dynamiques basees sur window.location
- Frontend build statique: `cd /app/frontend && yarn build`
- Selenium necessite: chromium + chromedriver installes systeme
- Pas de base de donnees - tout est en JSON

## Prioritized Backlog
### P1 (Next)
- Export PDF des rapports de test avec screenshots
### P2 (Future)
- Drag & drop pour reorganiser les etapes
- Tests programmes (cron)
