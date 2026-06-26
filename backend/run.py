#!/usr/bin/env python
"""
Backend server startup script
Run with: python run.py
"""

import uvicorn
from app import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3672)