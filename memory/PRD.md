# QA Crawler Bot - PRD

## Original Problem Statement
Application Playwright de test automatise qui explore un site web, clique partout, remplit les formulaires automatiquement et s'arrete quand elle trouve un bug. Dashboard web pour controler les tests. Stockage JSON des tests pour eviter les doublons.

## User Personas
- **Developpeur QA**: Veut tester automatiquement son site sans ecrire de scripts
- **Developpeur Web**: Veut detecter les bugs rapidement avant mise en production

## Core Requirements
- Dashboard web de controle des tests
- Exploration automatique avec Playwright
- Remplissage automatique des formulaires
- Detection des bugs (HTTP errors, JS errors)
- Stockage JSON pour eviter les doublons
- Mise a jour en temps reel via WebSocket
- Journal d'activite en temps reel avec captures d'ecran

## Technical Stack (CURRENT)
- **Backend**: Node.js, Express, Playwright, WebSocket
- **Frontend**: Angular 21 (Standalone Components, zone-less), static build served via http-server
- **Storage**: JSON files (scenarios.json, tests.json) - NO DATABASE
- **Design**: Swiss/Brutalist (Chivo, IBM Plex Sans, JetBrains Mono)

## What's Been Implemented

### Phase 1 - Core (Done)
- Backend Node.js/Express avec Playwright engine
- Frontend Angular 21 avec design Swiss/Brutalist
- WebSocket pour updates temps reel
- Stockage JSON des sessions et scenarios
- Detection erreurs console JavaScript
- Navigation automatique entre pages
- Clic sur boutons
- Remplissage formulaires (text, email, password, select, checkbox)
- Creation de scenarios avec etapes personnalisees
- Execution de scenarios avec captures d'ecran par etape
- Historique des sessions de test
- Suppression de scenarios et sessions

### Phase 2 - UX (Done)
- Desactivation auto-refresh Angular (build statique)
- Suppression de "Test Rapide" du dashboard
- Fix bug double-clic sur "Executer"
- Logs en temps reel affiches a cote du bouton Executer

### Phase 3 - Journal d'Activite (Done - April 2026)
- Onglet "Journal" dans la sidebar
- Vue split: Scenario Prevu (gauche) + Execution en Direct (droite)
- Badge LIVE avec animation pulse pendant l'execution
- Bouton STOP accessible dans le journal
- Timeline en temps reel avec evenements types (STATUT, ETAPE, BUG, LOG)
- Screenshots depliables/repliables par etape ("Voir capture" / "Masquer capture")
- Progression du scenario trackee (numeros verts + OK)
- Auto-switch vers le journal quand un test demarre
- Reconstruction du journal depuis l'historique (clic sur session passee)
- Bugs affiches en rouge avec URL
- Fix: ChangeDetectorRef pour Angular zone-less (WebSocket + change detection)

## Prioritized Backlog

### P1 (Next)
- Export PDF des rapports de test avec screenshots

### P2 (Future)
- Drag & drop pour reorganiser les etapes d'un scenario
- Tests programmes (cron)
- Integration email/Slack pour alertes
- Comparaison entre runs
- Support authentification OAuth

## Key Architecture

### Files
- `/app/backend/server.js` - API + Playwright + WebSocket
- `/app/frontend/src/app/app.ts` - Angular component logic
- `/app/frontend/src/app/app.html` - Template
- `/app/frontend/src/app/app.scss` - Styles

### Data
- `/app/backend/data/scenarios.json` - Scenarios crees
- `/app/backend/data/tests.json` - Historique des sessions

### API Endpoints
- GET /api/scenarios
- POST /api/scenarios
- PUT /api/scenarios/:id
- DELETE /api/scenarios/:id
- GET /api/tests/sessions
- GET /api/tests/status
- POST /api/tests/start
- POST /api/tests/stop
- DELETE /api/tests/sessions/:id
- GET /api/screenshots/:filename

### IMPORTANT
- Angular 21 fonctionne en mode ZONE-LESS: utiliser ChangeDetectorRef.detectChanges() pour forcer le rendu apres WebSocket
- Frontend est un build statique. Apres modification, executer `cd /app/frontend && yarn build`
- Pas de hot-reload Angular
- Pas de base de donnees - tout est en JSON
