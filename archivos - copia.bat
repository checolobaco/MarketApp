@echo off

curl http://localhost:4000/api/xau/scalp/stats/by-quality > by_quality.json
curl http://localhost:4000/api/xau/scalp/stats/by-hour > by_hour.json
curl http://localhost:4000/api/xau/scalp/stats/by-adx > by_adx.json
curl http://localhost:4000/api/xau/scalp/stats/by-atr > by_atr.json
curl http://localhost:4000/api/xau/scalp/stats/by-session > by_session.json
curl http://localhost:4000/api/xau/scalp/stats/tpsl-by-quality > tpsl_quality.json
curl http://localhost:4000/api/xau/scalp/stats/tpsl-by-hour > tpsl_hour.json
curl http://localhost:4000/api/xau/scalp/stats/tpsl-by-adx > tpsl_adx.json
curl http://localhost:4000/api/xau/scalp/stats/tpsl-by-atr > tpsl_atr.json
curl http://localhost:4000/api/xau/scalp/stats/tpsl-by-session > tpsl_session.json

echo LISTO
pause