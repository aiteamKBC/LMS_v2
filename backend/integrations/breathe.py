from __future__ import annotations

import re
import time
from collections import deque
from urllib.parse import urljoin

import requests


RESOURCE_PATHS = {
    "account": "/v1/account",
    "employees": "/v1/employees",
    "departments": "/v1/departments",
    "divisions": "/v1/divisions",
    "working_patterns": "/v1/working_patterns",
    "leave_requests": "/v1/leave_requests",
    "training_courses": "/v1/employee_training_courses",
}


class BreatheApiError(RuntimeError):
    def __init__(self, message, *, status=None, retryable=False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class BreatheClient:
    def __init__(self, base_url, api_key, *, session=None, sleep=time.sleep, max_requests=40, window_seconds=60):
        self.base_url = base_url.rstrip("/") + "/"
        self.api_key = api_key
        self.session = session or requests.Session()
        self.sleep = sleep
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests = deque()

    def _rate_limit(self):
        now = time.monotonic()
        while self._requests and now - self._requests[0] >= self.window_seconds:
            self._requests.popleft()
        if len(self._requests) >= self.max_requests:
            self.sleep(max(0.05, self.window_seconds - (now - self._requests[0])))
            self._rate_limit()
        self._requests.append(time.monotonic())

    def request_json(self, method, path, *, params=None, json=None, retries=3):
        if not self.api_key:
            raise BreatheApiError("Breathe API key is not configured.")
        url = path if path.startswith("http") else urljoin(self.base_url, path.lstrip("/"))
        for attempt in range(retries + 1):
            self._rate_limit()
            try:
                response = self.session.request(method, url, params=params, json=json, headers={"X-API-KEY": self.api_key, "Accept": "application/json"}, timeout=30)
            except requests.RequestException as exc:
                if attempt >= retries:
                    raise BreatheApiError("Breathe request failed.", retryable=True) from exc
                self.sleep(2 ** attempt)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= retries:
                    raise BreatheApiError("Breathe returned a retryable error.", status=response.status_code, retryable=True)
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else 2 ** attempt
                except ValueError:
                    delay = 2 ** attempt
                self.sleep(min(delay, 60))
                continue
            if not response.ok:
                raise BreatheApiError("Breathe rejected the request.", status=response.status_code, retryable=False)
            try:
                return response.json(), response.headers
            except ValueError as exc:
                raise BreatheApiError("Breathe returned invalid JSON.", status=response.status_code) from exc
        raise BreatheApiError("Breathe request exhausted retries.", retryable=True)

    def account(self):
        return self.request_json("GET", RESOURCE_PATHS["account"])[0]

    def list_resource(self, resource, *, per_page=100):
        if resource not in RESOURCE_PATHS:
            raise ValueError(f"Unsupported Breathe resource: {resource}")
        path = RESOURCE_PATHS[resource]
        params = {"page": 1, "per_page": min(max(int(per_page), 1), 100)}
        while path:
            payload, headers = self.request_json("GET", path, params=params)
            items = self._items(payload, resource)
            for item in items:
                yield item
            path = self._next_link(headers.get("Link") or headers.get("link"))
            params = None

    @staticmethod
    def _items(payload, resource):
        if isinstance(payload, list):
            return payload
        if not isinstance(payload, dict):
            return []
        keys = {resource, resource.rstrip("s"), "employees" if resource == "employees" else resource}
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
        for value in payload.values():
            if isinstance(value, list):
                return value
        return []

    @staticmethod
    def _next_link(value):
        if not value:
            return None
        for part in str(value).split(","):
            match = re.search(r"<([^>]+)>\s*;\s*rel=\"next\"", part, re.I)
            if match:
                return match.group(1)
        return None
