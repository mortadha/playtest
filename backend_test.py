#!/usr/bin/env python3
"""
QA Crawler Bot Backend API Testing
Tests all API endpoints and functionality
"""

import requests
import json
import sys
import time
from datetime import datetime

class QACrawlerAPITester:
    def __init__(self, base_url="https://qa-crawler-bot.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.session_id = None

    def log(self, message, test_type="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {test_type}: {message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, timeout=30):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}" if endpoint else self.api_url
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        self.log(f"Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}", "PASS")
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}", "FAIL")
                try:
                    self.log(f"Response: {response.json()}", "ERROR")
                except:
                    self.log(f"Response: {response.text}", "ERROR")
                return False, {}

        except Exception as e:
            self.log(f"❌ {name} - Error: {str(e)}", "ERROR")
            return False, {}

    def test_root_endpoint(self):
        """Test root API endpoint"""
        return self.run_test("Root API", "GET", "", 200)

    def test_get_status(self):
        """Test get test status"""
        return self.run_test("Get Test Status", "GET", "tests/status", 200)

    def test_get_sessions(self):
        """Test get sessions"""
        return self.run_test("Get Sessions", "GET", "tests/sessions", 200)

    def test_get_history(self):
        """Test get history"""
        return self.run_test("Get History", "GET", "tests/history", 200)

    def test_get_bugs(self):
        """Test get all bugs"""
        return self.run_test("Get All Bugs", "GET", "tests/bugs", 200)

    def test_start_test(self):
        """Test starting a test"""
        config = {
            "target_url": "https://httpbin.org/html",
            "max_depth": 2,
            "fill_forms": True,
            "login_credentials": None
        }
        
        success, response = self.run_test("Start Test", "POST", "tests/start", 200, config)
        if success and 'session_id' in response:
            self.session_id = response['session_id']
            self.log(f"Test started with session ID: {self.session_id}")
            return True
        return False

    def test_stop_test(self):
        """Test stopping a test"""
        if not self.session_id:
            self.log("No active session to stop", "SKIP")
            return True
        
        # Wait a bit for test to start
        time.sleep(2)
        return self.run_test("Stop Test", "POST", "tests/stop", 200)[0]

    def test_start_test_validation(self):
        """Test start test with invalid data"""
        # Test without target_url
        config = {
            "max_depth": 2,
            "fill_forms": True
        }
        
        success, response = self.run_test("Start Test (Invalid)", "POST", "tests/start", 422, config)
        return success

    def test_stop_when_not_running(self):
        """Test stopping when no test is running"""
        success, response = self.run_test("Stop Test (Not Running)", "POST", "tests/stop", 400)
        return success

    def test_clear_history(self):
        """Test clearing history"""
        return self.run_test("Clear History", "DELETE", "tests/history/clear", 200)[0]

    def run_all_tests(self):
        """Run all API tests"""
        self.log("Starting QA Crawler Bot API Tests")
        self.log(f"Testing against: {self.base_url}")
        
        # Basic API tests
        self.test_root_endpoint()
        self.test_get_status()
        self.test_get_sessions()
        self.test_get_history()
        self.test_get_bugs()
        
        # Test validation
        self.test_start_test_validation()
        self.test_stop_when_not_running()
        
        # Test workflow
        if self.test_start_test():
            time.sleep(1)  # Let test start
            self.test_stop_test()
        
        # Cleanup tests
        self.test_clear_history()
        
        # Print results
        self.log(f"Tests completed: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 All tests passed!", "SUCCESS")
            return 0
        else:
            self.log(f"❌ {self.tests_run - self.tests_passed} tests failed", "FAIL")
            return 1

def main():
    tester = QACrawlerAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())