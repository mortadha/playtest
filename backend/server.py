from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
from enum import Enum

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JSON file for test history
TEST_HISTORY_FILE = ROOT_DIR / 'test_history.json'

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# Global test state
test_state = {
    "running": False,
    "session_id": None,
    "should_stop": False
}

# Enums
class TestStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    STOPPED = "stopped"
    ERROR = "error"

class BugSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

# Models
class TestConfig(BaseModel):
    target_url: str
    max_depth: int = 5
    fill_forms: bool = True
    login_credentials: Optional[Dict[str, str]] = None
    excluded_paths: List[str] = []

class Bug(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str
    message: str
    url: str
    selector: Optional[str] = None
    screenshot: Optional[str] = None
    severity: BugSeverity = BugSeverity.MEDIUM
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class DiscoveredElement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str  # link, button, form, input
    selector: str
    url: str
    text: Optional[str] = None
    tested: bool = False

class TestSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    target_url: str
    status: TestStatus = TestStatus.PENDING
    started_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    ended_at: Optional[str] = None
    urls_scanned: int = 0
    elements_found: int = 0
    forms_found: int = 0
    bugs_found: int = 0
    visited_urls: List[str] = []
    tested_elements: List[str] = []
    bugs: List[Bug] = []

class TestSessionCreate(BaseModel):
    target_url: str
    max_depth: int = 5
    fill_forms: bool = True
    login_credentials: Optional[Dict[str, str]] = None

# Helper functions
def load_test_history() -> Dict[str, Any]:
    if TEST_HISTORY_FILE.exists():
        with open(TEST_HISTORY_FILE, 'r') as f:
            return json.load(f)
    return {"sessions": [], "tested_elements": {}}

def save_test_history(history: Dict[str, Any]):
    with open(TEST_HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

def is_element_tested(url: str, selector: str) -> bool:
    history = load_test_history()
    key = f"{url}::{selector}"
    return key in history.get("tested_elements", {})

def mark_element_tested(url: str, selector: str):
    history = load_test_history()
    if "tested_elements" not in history:
        history["tested_elements"] = {}
    key = f"{url}::{selector}"
    history["tested_elements"][key] = datetime.now(timezone.utc).isoformat()
    save_test_history(history)

# Playwright Test Engine
async def run_test_exploration(session_id: str, config: TestConfig):
    from playwright.async_api import async_playwright
    
    global test_state
    test_state["running"] = True
    test_state["session_id"] = session_id
    test_state["should_stop"] = False
    
    session = None
    
    try:
        # Get or create session in DB
        session_doc = await db.test_sessions.find_one({"id": session_id}, {"_id": 0})
        if session_doc:
            session = TestSession(**session_doc)
        else:
            return
        
        session.status = TestStatus.RUNNING
        await db.test_sessions.update_one(
            {"id": session_id},
            {"$set": {"status": "running"}}
        )
        await manager.broadcast({"type": "status", "status": "running", "session_id": session_id})
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            page = await context.new_page()
            
            # Error listener
            errors_found = []
            
            def handle_console(msg):
                if msg.type == "error":
                    errors_found.append({
                        "type": "console_error",
                        "message": msg.text,
                        "url": page.url
                    })
            
            page.on("console", handle_console)
            
            # Handle page errors
            def handle_page_error(error):
                errors_found.append({
                    "type": "page_error",
                    "message": str(error),
                    "url": page.url
                })
            
            page.on("pageerror", handle_page_error)
            
            # URLs to visit
            urls_to_visit = [config.target_url]
            visited_urls = set()
            
            while urls_to_visit and not test_state["should_stop"]:
                current_url = urls_to_visit.pop(0)
                
                if current_url in visited_urls:
                    continue
                
                # Check excluded paths
                skip = False
                for excluded in config.excluded_paths:
                    if excluded in current_url:
                        skip = True
                        break
                if skip:
                    continue
                
                try:
                    await manager.broadcast({
                        "type": "progress",
                        "message": f"Visiting: {current_url}",
                        "url": current_url
                    })
                    
                    response = await page.goto(current_url, wait_until="networkidle", timeout=30000)
                    
                    # Check for HTTP errors
                    if response and response.status >= 400:
                        bug = Bug(
                            type="http_error",
                            message=f"HTTP {response.status}: {response.status_text}",
                            url=current_url,
                            severity=BugSeverity.HIGH if response.status >= 500 else BugSeverity.MEDIUM
                        )
                        session.bugs.append(bug)
                        await db.test_sessions.update_one(
                            {"id": session_id},
                            {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                        )
                        await manager.broadcast({
                            "type": "bug",
                            "bug": bug.model_dump()
                        })
                    
                    visited_urls.add(current_url)
                    session.urls_scanned += 1
                    session.visited_urls.append(current_url)
                    
                    await db.test_sessions.update_one(
                        {"id": session_id},
                        {"$inc": {"urls_scanned": 1}, "$push": {"visited_urls": current_url}}
                    )
                    
                    # Wait for page to settle
                    await asyncio.sleep(1)
                    
                    # Check for JS errors that occurred
                    for error in errors_found:
                        bug = Bug(
                            type=error["type"],
                            message=error["message"],
                            url=error["url"],
                            severity=BugSeverity.HIGH
                        )
                        session.bugs.append(bug)
                        await db.test_sessions.update_one(
                            {"id": session_id},
                            {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                        )
                        await manager.broadcast({
                            "type": "bug",
                            "bug": bug.model_dump()
                        })
                        
                        # Stop on bug found
                        if error["type"] == "page_error":
                            test_state["should_stop"] = True
                            await manager.broadcast({
                                "type": "stopped",
                                "reason": "Bug found - stopping test",
                                "bug": bug.model_dump()
                            })
                            break
                    
                    errors_found.clear()
                    
                    if test_state["should_stop"]:
                        break
                    
                    # Find all links
                    links = await page.query_selector_all("a[href]")
                    for link in links:
                        try:
                            href = await link.get_attribute("href")
                            if href:
                                if href.startswith("/"):
                                    href = config.target_url.rstrip("/") + href
                                elif not href.startswith("http"):
                                    continue
                                
                                # Only add links from same domain
                                if config.target_url.split("//")[1].split("/")[0] in href:
                                    if href not in visited_urls and href not in urls_to_visit:
                                        urls_to_visit.append(href)
                        except:
                            pass
                    
                    # Find and click buttons
                    buttons = await page.query_selector_all("button, [role='button'], input[type='submit']")
                    for button in buttons:
                        if test_state["should_stop"]:
                            break
                        
                        try:
                            selector = await button.evaluate("el => el.outerHTML.slice(0, 100)")
                            element_key = f"{current_url}::{selector}"
                            
                            if is_element_tested(current_url, selector):
                                continue
                            
                            is_visible = await button.is_visible()
                            is_enabled = await button.is_enabled()
                            
                            if is_visible and is_enabled:
                                text = await button.inner_text() or ""
                                
                                # Skip navigation/logout buttons
                                skip_texts = ["logout", "déconnexion", "sign out", "delete", "supprimer"]
                                if any(skip in text.lower() for skip in skip_texts):
                                    continue
                                
                                await manager.broadcast({
                                    "type": "action",
                                    "message": f"Clicking button: {text[:50]}",
                                    "element": "button"
                                })
                                
                                session.elements_found += 1
                                await db.test_sessions.update_one(
                                    {"id": session_id},
                                    {"$inc": {"elements_found": 1}}
                                )
                                
                                try:
                                    await button.click(timeout=5000)
                                    await asyncio.sleep(1)
                                    mark_element_tested(current_url, selector)
                                except Exception as e:
                                    # Button click failed - might be a bug
                                    if "timeout" not in str(e).lower():
                                        bug = Bug(
                                            type="click_error",
                                            message=f"Failed to click button: {str(e)}",
                                            url=current_url,
                                            selector=selector,
                                            severity=BugSeverity.LOW
                                        )
                                        session.bugs.append(bug)
                                        await db.test_sessions.update_one(
                                            {"id": session_id},
                                            {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                                        )
                                        await manager.broadcast({
                                            "type": "bug",
                                            "bug": bug.model_dump()
                                        })
                        except:
                            pass
                    
                    # Find and fill forms
                    if config.fill_forms:
                        forms = await page.query_selector_all("form")
                        session.forms_found += len(forms)
                        await db.test_sessions.update_one(
                            {"id": session_id},
                            {"$inc": {"forms_found": len(forms)}}
                        )
                        
                        for form in forms:
                            if test_state["should_stop"]:
                                break
                            
                            try:
                                form_html = await form.evaluate("el => el.outerHTML.slice(0, 100)")
                                
                                if is_element_tested(current_url, form_html):
                                    continue
                                
                                await manager.broadcast({
                                    "type": "action",
                                    "message": "Filling form...",
                                    "element": "form"
                                })
                                
                                # Fill text inputs
                                inputs = await form.query_selector_all("input[type='text'], input[type='email'], input[type='password'], input[type='search'], input[type='tel'], input[type='number'], textarea")
                                
                                for input_el in inputs:
                                    try:
                                        input_type = await input_el.get_attribute("type") or "text"
                                        input_name = await input_el.get_attribute("name") or ""
                                        placeholder = await input_el.get_attribute("placeholder") or ""
                                        
                                        # Determine test value
                                        if input_type == "email" or "email" in input_name.lower() or "email" in placeholder.lower():
                                            value = "test@example.com"
                                        elif input_type == "password" or "password" in input_name.lower():
                                            if config.login_credentials and "password" in config.login_credentials:
                                                value = config.login_credentials["password"]
                                            else:
                                                value = "TestPassword123!"
                                        elif input_type == "tel" or "phone" in input_name.lower():
                                            value = "0612345678"
                                        elif input_type == "number":
                                            value = "42"
                                        elif "search" in input_name.lower() or "search" in placeholder.lower() or input_type == "search":
                                            value = "test search query"
                                        elif "name" in input_name.lower() or "nom" in input_name.lower():
                                            value = "Test User"
                                        elif "titre" in input_name.lower() or "title" in input_name.lower():
                                            value = "Test Title"
                                        elif "dossier" in input_name.lower() or "folder" in input_name.lower():
                                            value = "Test Dossier"
                                        else:
                                            value = "Test Input Value"
                                        
                                        # Use login credentials if available
                                        if config.login_credentials:
                                            if "email" in input_name.lower() or "username" in input_name.lower():
                                                if "email" in config.login_credentials:
                                                    value = config.login_credentials["email"]
                                                elif "username" in config.login_credentials:
                                                    value = config.login_credentials["username"]
                                        
                                        await input_el.fill(value)
                                        await asyncio.sleep(0.2)
                                    except Exception as e:
                                        pass
                                
                                # Fill select dropdowns
                                selects = await form.query_selector_all("select")
                                for select in selects:
                                    try:
                                        options = await select.query_selector_all("option")
                                        if len(options) > 1:
                                            option_value = await options[1].get_attribute("value")
                                            if option_value:
                                                await select.select_option(option_value)
                                    except:
                                        pass
                                
                                # Check checkboxes
                                checkboxes = await form.query_selector_all("input[type='checkbox']")
                                for checkbox in checkboxes:
                                    try:
                                        if not await checkbox.is_checked():
                                            await checkbox.check()
                                    except:
                                        pass
                                
                                # Submit form
                                submit_btn = await form.query_selector("button[type='submit'], input[type='submit']")
                                if submit_btn:
                                    try:
                                        await submit_btn.click()
                                        await asyncio.sleep(2)
                                        
                                        # Check for errors after form submission
                                        for error in errors_found:
                                            bug = Bug(
                                                type="form_submission_error",
                                                message=error["message"],
                                                url=error["url"],
                                                selector=form_html,
                                                severity=BugSeverity.HIGH
                                            )
                                            session.bugs.append(bug)
                                            await db.test_sessions.update_one(
                                                {"id": session_id},
                                                {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                                            )
                                            await manager.broadcast({
                                                "type": "bug",
                                                "bug": bug.model_dump()
                                            })
                                            test_state["should_stop"] = True
                                        
                                        errors_found.clear()
                                        mark_element_tested(current_url, form_html)
                                    except Exception as e:
                                        bug = Bug(
                                            type="form_submit_error",
                                            message=f"Form submission failed: {str(e)}",
                                            url=current_url,
                                            selector=form_html,
                                            severity=BugSeverity.MEDIUM
                                        )
                                        session.bugs.append(bug)
                                        await db.test_sessions.update_one(
                                            {"id": session_id},
                                            {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                                        )
                                        await manager.broadcast({
                                            "type": "bug",
                                            "bug": bug.model_dump()
                                        })
                            except:
                                pass
                    
                    await manager.broadcast({
                        "type": "stats",
                        "urls_scanned": session.urls_scanned,
                        "elements_found": session.elements_found,
                        "forms_found": session.forms_found,
                        "bugs_found": len(session.bugs)
                    })
                    
                except Exception as e:
                    bug = Bug(
                        type="navigation_error",
                        message=f"Failed to navigate: {str(e)}",
                        url=current_url,
                        severity=BugSeverity.HIGH
                    )
                    session.bugs.append(bug)
                    await db.test_sessions.update_one(
                        {"id": session_id},
                        {"$push": {"bugs": bug.model_dump()}, "$inc": {"bugs_found": 1}}
                    )
                    await manager.broadcast({
                        "type": "bug",
                        "bug": bug.model_dump()
                    })
            
            await browser.close()
        
        # Update final status
        final_status = TestStatus.STOPPED if test_state["should_stop"] else TestStatus.COMPLETED
        session.status = final_status
        session.ended_at = datetime.now(timezone.utc).isoformat()
        
        await db.test_sessions.update_one(
            {"id": session_id},
            {"$set": {
                "status": final_status.value,
                "ended_at": session.ended_at
            }}
        )
        
        # Save to history
        history = load_test_history()
        history["sessions"].append({
            "id": session.id,
            "target_url": session.target_url,
            "status": final_status.value,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "urls_scanned": session.urls_scanned,
            "elements_found": session.elements_found,
            "forms_found": session.forms_found,
            "bugs_found": len(session.bugs),
            "bugs": [b.model_dump() for b in session.bugs]
        })
        save_test_history(history)
        
        await manager.broadcast({
            "type": "completed",
            "status": final_status.value,
            "session": {
                "id": session.id,
                "urls_scanned": session.urls_scanned,
                "elements_found": session.elements_found,
                "forms_found": session.forms_found,
                "bugs_found": len(session.bugs)
            }
        })
        
    except Exception as e:
        logging.error(f"Test error: {e}")
        await db.test_sessions.update_one(
            {"id": session_id},
            {"$set": {"status": "error", "ended_at": datetime.now(timezone.utc).isoformat()}}
        )
        await manager.broadcast({
            "type": "error",
            "message": str(e)
        })
    finally:
        test_state["running"] = False
        test_state["session_id"] = None

# API Routes
@api_router.get("/")
async def root():
    return {"message": "QA Crawler Bot API"}

@api_router.post("/tests/start")
async def start_test(config: TestSessionCreate, background_tasks: BackgroundTasks):
    global test_state
    
    if test_state["running"]:
        return JSONResponse(
            status_code=400,
            content={"error": "A test is already running"}
        )
    
    session = TestSession(target_url=config.target_url)
    
    # Save session to DB
    await db.test_sessions.insert_one(session.model_dump())
    
    # Create config
    test_config = TestConfig(
        target_url=config.target_url,
        max_depth=config.max_depth,
        fill_forms=config.fill_forms,
        login_credentials=config.login_credentials
    )
    
    # Start test in background
    background_tasks.add_task(run_test_exploration, session.id, test_config)
    
    return {"session_id": session.id, "status": "started"}

@api_router.post("/tests/stop")
async def stop_test():
    global test_state
    
    if not test_state["running"]:
        return JSONResponse(
            status_code=400,
            content={"error": "No test is running"}
        )
    
    test_state["should_stop"] = True
    return {"status": "stopping"}

@api_router.get("/tests/status")
async def get_test_status():
    global test_state
    
    if not test_state["running"]:
        return {"running": False, "session_id": None}
    
    session = await db.test_sessions.find_one(
        {"id": test_state["session_id"]},
        {"_id": 0}
    )
    
    return {
        "running": True,
        "session_id": test_state["session_id"],
        "session": session
    }

@api_router.get("/tests/sessions")
async def get_sessions():
    sessions = await db.test_sessions.find({}, {"_id": 0}).sort("started_at", -1).to_list(100)
    return sessions

@api_router.get("/tests/sessions/{session_id}")
async def get_session(session_id: str):
    session = await db.test_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    return session

@api_router.delete("/tests/sessions/{session_id}")
async def delete_session(session_id: str):
    result = await db.test_sessions.delete_one({"id": session_id})
    if result.deleted_count == 0:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    return {"status": "deleted"}

@api_router.get("/tests/history")
async def get_history():
    history = load_test_history()
    return history

@api_router.delete("/tests/history/clear")
async def clear_history():
    save_test_history({"sessions": [], "tested_elements": {}})
    return {"status": "cleared"}

@api_router.get("/tests/bugs")
async def get_all_bugs():
    sessions = await db.test_sessions.find({}, {"_id": 0, "bugs": 1}).to_list(1000)
    all_bugs = []
    for session in sessions:
        all_bugs.extend(session.get("bugs", []))
    return all_bugs

# WebSocket endpoint
@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle ping/pong for keepalive
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
