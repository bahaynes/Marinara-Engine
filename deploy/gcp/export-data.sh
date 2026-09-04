#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Marinara Engine — Export Nomadic Data for Home Server Migration
# ─────────────────────────────────────────────────────────────────────────────
# Creates a compressed archive of all chats, settings, cards, and assets
# created during the nomadic period so you can restore them on your home server.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [ -f "${ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

DATA_DIR="${MARINARA_DATA_DIR:-${SCRIPT_DIR}/marinara-data}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="marinara-nomadic-backup-${TIMESTAMP}.tar.gz"
OUTPUT_PATH="${HOME}/${ARCHIVE_NAME}"

echo "=== [1/3] Preparing data directory for export ==="
if [ ! -d "${DATA_DIR}" ]; then
  echo "Error: Data directory '${DATA_DIR}' not found!"
  exit 1
fi

echo "Flushing SQLite WAL / syncing disk..."
sync

echo "=== [2/3] Creating archive: ${OUTPUT_PATH} ==="
# Preserve permissions and timestamps
sudo tar -czf "${OUTPUT_PATH}" -C "${DATA_DIR}" .
sudo chown "${USER}:${USER}" "${OUTPUT_PATH}"
ARCHIVE_SIZE=$(du -h "${OUTPUT_PATH}" | cut -f1)

echo "=== [3/3] Export complete (${ARCHIVE_SIZE}) ==="
echo ""
echo "Archive saved to: ${OUTPUT_PATH}"
echo ""
echo "TO DOWNLOAD TO YOUR LAPTOP OR HOME SERVER:"
echo "Run this from your local computer (not the VM):"
echo ""
echo "  gcloud compute scp <INSTANCE_NAME>:${OUTPUT_PATH} ./ --zone=<ZONE>"
echo "  # OR via standard scp:"
echo "  scp <USER>@<VM_IP>:${OUTPUT_PATH} ./"
echo ""
echo "TO RESTORE ON YOUR HOME SERVER:"
echo "Extract into your home server's data folder (e.g. docker volume or local folder):"
echo ""
echo "  tar -xzf ${ARCHIVE_NAME} -C /path/to/home/marinara-data"
echo "=========================================================================="

