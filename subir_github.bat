@echo off
:: Configurar la ruta de Git Portable en el PATH temporalmente
set "PATH=C:\0DE\PortableGit\cmd;%PATH%"

echo [1/5] Inicializando repositorio Git (si no esta inicializado)...
git init

echo [2/5] Configurando repositorio remoto...
:: Remover origin anterior si existe para evitar errores
git remote remove origin 2>nul
git remote add origin https://github.com/checolobaco/MarketApp.git

echo [3/5] Creando la rama principal 'main'...
git branch -M main

echo [4/5] Agregando archivos al commit...
git add .

echo [5/5] Realizando commit local...
git commit -m "Preparar proyecto para despliegue en Railway (Servicio Unico)"

echo.
echo ====================================================
echo Listo para enviar cambios a GitHub.
echo Si es la primera vez que subes, se abrira una ventana
echo en tu navegador para autenticarte con tu cuenta.
echo ====================================================
echo.

git push -u origin main

pause
