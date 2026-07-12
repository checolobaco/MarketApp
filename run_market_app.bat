@echo off
title MarketApp Launcher (Unificado)
echo ===================================================
echo             INICIANDO SYSTEM MARKETAPP (UNIFICADO)
echo ===================================================
echo.

:: 1. Iniciar Servidor Unificado (Backend + Frontend)
echo [1/2] Lanzando servidor unificado en puerto 4000...
start "MarketApp Server" cmd /c "npm run dev"

:: 2. Esperar y abrir navegador
echo [2/2] Esperando 3 segundos a que los servicios se inicien...
timeout /t 3 /nobreak >nul

echo Abriendo consola operativa en el navegador (http://localhost:4000)...
start http://localhost:4000

echo.
echo ===================================================
echo  Servidor corriendo en segundo plano.
echo  Puedes interactuar desde el navegador.
echo ===================================================
timeout /t 5 >nul
exit
