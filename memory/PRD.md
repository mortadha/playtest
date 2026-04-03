# QA Crawler Bot - PRD

## Original Problem Statement
Application Playwright de test automatisé qui explore un site web, clique partout, remplit les formulaires automatiquement et s'arrête quand elle trouve un bug. Dashboard web pour contrôler les tests. Stockage JSON des tests pour éviter les doublons.

## User Personas
- **Développeur QA**: Veut tester automatiquement son site sans écrire de scripts
- **Développeur Web**: Veut détecter les bugs rapidement avant mise en production

## Core Requirements
- Dashboard web de contrôle des tests
- Exploration automatique avec Playwright
- Remplissage automatique des formulaires
- Détection des bugs (HTTP errors, JS errors)
- Stockage JSON pour éviter les doublons
- Mise à jour en temps réel via WebSocket

## What's Been Implemented (April 2026)
- ✅ Backend FastAPI avec Playwright async
- ✅ Frontend React avec design Swiss/Brutalist
- ✅ WebSocket pour updates temps réel
- ✅ Stockage MongoDB des sessions
- ✅ Fichier JSON pour historique des éléments testés
- ✅ Détection erreurs HTTP (4xx, 5xx)
- ✅ Détection erreurs console JavaScript
- ✅ Navigation automatique entre pages
- ✅ Clic sur boutons
- ✅ Remplissage formulaires (text, email, password, select, checkbox)

## Prioritized Backlog
### P0 (Done)
- Dashboard de contrôle
- Start/Stop tests
- Détection bugs HTTP
- Stockage JSON

### P1 (Next)
- Screenshots sur bug détecté
- Rapport PDF exportable
- Règles d'exclusion avancées

### P2 (Future)
- Intégration email/Slack pour alertes
- Tests programmés (cron)
- Comparaison entre runs
- Support authentification OAuth

## Technical Stack
- Backend: FastAPI, Playwright, MongoDB, Motor
- Frontend: React, Tailwind, Shadcn/UI, Phosphor Icons
- Design: Swiss/Brutalist (Chivo, IBM Plex Sans, JetBrains Mono)
