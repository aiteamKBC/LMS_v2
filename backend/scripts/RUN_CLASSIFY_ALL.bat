@echo off
REM Double-click to classify ALL learner evidence (safe to re-run anytime —
REM it skips everything already classified and continues from where it stopped).
title LMS Evidence Classifier
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0classify_all_evidence.ps1"
echo.
echo ================= FINISHED =================
pause
