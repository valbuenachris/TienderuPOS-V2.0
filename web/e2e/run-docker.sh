#!/bin/sh
# E2E del POS en Docker, sin Node en el host.
# Ejecuta desde la RAÍZ del repo (donde está package-lock.json):
#   E2E_BASE_URL='http://127.0.0.1:8096' \
#   E2E_CASHIER_USERNAME='cajero.demo' E2E_CASHIER_PASSWORD='...' E2E_PRODUCT_CODE='770...' \
#   ./web/e2e/run-docker.sh
set -eu

: "${E2E_CASHIER_USERNAME:?define E2E_CASHIER_USERNAME}"
: "${E2E_CASHIER_PASSWORD:?define E2E_CASHIER_PASSWORD}"
: "${E2E_PRODUCT_CODE:?define E2E_PRODUCT_CODE}"
: "${E2E_BASE_URL:=http://127.0.0.1:8096}"

VERSION=$(sed -n 's/.*"@playwright\/test": *"[~^]*\([0-9][0-9.]*\)".*/\1/p' web/package.json | head -n1)
if [ -z "$VERSION" ]; then
  echo "No pude leer la versión de @playwright/test de web/package.json" >&2
  exit 1
fi

IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
echo "Usando $IMAGE contra $E2E_BASE_URL"
echo "⚠️  Crea una venta real: ejecútalo solo contra un ambiente de PRUEBAS."

# --network host permite alcanzar 127.0.0.1:<puerto> del host donde corras esto.
docker run --rm --network host \
  -v "$PWD":/work -w /work \
  -e E2E_BASE_URL="$E2E_BASE_URL" \
  -e E2E_CASHIER_USERNAME -e E2E_CASHIER_PASSWORD -e E2E_PRODUCT_CODE \
  "$IMAGE" \
  sh -lc "npm ci --no-audit --no-fund && npm --workspace web run test:e2e"
