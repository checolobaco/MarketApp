# Endpoints Forex.com / StoneX para CMD

Este archivo reúne los endpoints usados por la integración de Forex.com (StoneX) en este proyecto, con ejemplos listos para ejecutar desde Windows CMD.

> Base URL esperada: http://localhost:4000/api/forexcom
>
> Si tu servidor usa otro puerto, cambia 4000 por el puerto correcto.

## 1) Preparación rápida en CMD

```cmd
set BASE_URL=http://localhost:4000/api/forexcom
```

## 2) Configuración y autenticación

### GET /config
Muestra la configuración de acceso esperada por el backend.

```cmd
curl "%BASE_URL%/config"
```

### POST /login
Inicia sesión en Forex.com y devuelve datos de sesión.

```cmd
curl -X POST "%BASE_URL%/login" -H "Content-Type: application/json" -d "{\"username\":\"TU_USUARIO\",\"password\":\"TU_PASSWORD\",\"appKey\":\"TU_APPKEY\",\"isDemo\":\"false\"}"
```

### POST /logout
Cierra la sesión activa.

```cmd
curl -X POST "%BASE_URL%/logout" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /auth/status
Verifica si la sesión sigue válida.

```cmd
curl "%BASE_URL%/auth/status" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

## 3) Cuenta y mercado

### GET /account
Devuelve datos básicos de la cuenta.

```cmd
curl "%BASE_URL%/account" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /symbols
Busca símbolos/mercados por texto.

```cmd
curl "%BASE_URL%/symbols?query=Gold" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /markets
Lista mercados similares a /symbols, con más detalle.

```cmd
curl "%BASE_URL%/markets?query=EURUSD&maxResults=10" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /symbol
Obtiene información detallada de un símbolo o market ID.

```cmd
curl "%BASE_URL%/symbol?symbol=XAUUSD" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /quote
Obtiene cotización en vivo de un símbolo.

```cmd
curl "%BASE_URL%/quote?symbol=EURUSD" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

## 4) Posiciones y órdenes

### GET /positions
Lista posiciones abiertas.

```cmd
curl "%BASE_URL%/positions" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /orders
Lista órdenes activas/pending.

```cmd
curl "%BASE_URL%/orders" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### POST /trade
Abre una orden usando símbolo y dirección.

```cmd
curl -X POST "%BASE_URL%/trade" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"symbol\":\"XAUUSD\",\"action\":\"BUY\",\"volume\":1,\"price\":\"\",\"sl\":\"\",\"tp\":\"\"}"
```

### POST /order
Abre una orden usando marketId directamente.

```cmd
curl -X POST "%BASE_URL%/order" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"marketId\":1,\"direction\":\"BUY\",\"quantity\":1,\"price\":1.2345,\"bidPrice\":1.2344,\"offerPrice\":1.2346,\"stopLoss\":1.2300,\"takeProfit\":1.2400}"
```

### POST /close_position
Cierra una posición abierta.

```cmd
curl -X POST "%BASE_URL%/close_position" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"positionId\":123456,\"volume\":1,\"marketId\":1,\"direction\":\"BUY\"}"
```

### POST /modify_position
Cambia SL/TP de una posición.

```cmd
curl -X POST "%BASE_URL%/modify_position" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"positionId\":123456,\"sl\":1.2300,\"tp\":1.2400}"
```

## 5) Velas / historiales

### GET /candles
Obtiene velas históricas para un símbolo.

```cmd
curl "%BASE_URL%/candles?symbol=XAUUSD&interval=15m&days=3" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

### GET /candles/:marketId
Obtiene velas por marketId directamente.

```cmd
curl "%BASE_URL%/candles/1?interval=15m&span=20" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"
```

## 6) Predicción y trading automático

### POST /predict
Genera una predicción con indicadores y AI.

```cmd
curl -X POST "%BASE_URL%/predict" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"symbol\":\"EURUSD\",\"autoTrade\":false,\"volume\":1}"
```

### POST /predict_scalp
Genera una predicción de estilo scalp para XAU o símbolos compatibles.

```cmd
curl -X POST "%BASE_URL%/predict_scalp" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"symbol\":\"XAUUSD\",\"autoTrade\":false,\"volume\":1}"
```

## 7) Ejemplo completo de flujo recomendado

1. Login
2. Verificar sesión
3. Consultar cuenta
4. Obtener cotización
5. Abrir orden

```cmd
set BASE_URL=http://localhost:4000/api/forexcom

curl -X POST "%BASE_URL%/login" -H "Content-Type: application/json" -d "{\"username\":\"TU_USUARIO\",\"password\":\"TU_PASSWORD\",\"appKey\":\"TU_APPKEY\",\"isDemo\":\"false\"}"

curl "%BASE_URL%/auth/status" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"

curl "%BASE_URL%/account" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"

curl "%BASE_URL%/quote?symbol=EURUSD" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO"

curl -X POST "%BASE_URL%/trade" -H "Content-Type: application/json" -H "x-forex-session: TU_SESSION_TOKEN" -H "x-forex-username: TU_USUARIO" -d "{\"symbol\":\"EURUSD\",\"action\":\"BUY\",\"volume\":1,\"price\":\"\",\"sl\":\"\",\"tp\":\"\"}"
```

## 8) Notas

- Sustituye TU_USUARIO, TU_PASSWORD, TU_APPKEY y TU_SESSION_TOKEN por tus valores reales.
- Si el servidor está en otra máquina o puerto, cambia la variable BASE_URL.
- Para usar estos comandos desde CMD, conserva las comillas dobles y usa comillas escapadas dentro del JSON.
