@echo off
chcp 65001 >nul
title AI Interview Study Site
cd /d "%~dp0"
echo ============================================
echo   AI 面试学习站 - 本地启动
echo ============================================
echo.
where python >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] 未找到 python,请直接双击 app\index.html 打开(功能基本可用)。
  pause
  exit /b 1
)
echo 正在启动本地服务器 http://127.0.0.1:8765 ...
echo 关闭本窗口即可停止服务。
start "" http://127.0.0.1:8765/index.html
python tools\serve.py 8765
