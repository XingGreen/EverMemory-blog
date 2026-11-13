@echo off
setlocal
title Env Tool

rem Run from the project root: the server reads .env.local and .git from cwd.
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js not found. Install Node 22 or newer, then run this again.
	pause
	exit /b 1
)

node "%~dp0server.mjs"

if errorlevel 1 pause
