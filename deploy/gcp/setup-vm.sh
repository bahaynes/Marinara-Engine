#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Marinara Engine — GCP VM Bootstrap Script (Ubuntu/Debian)
# ─────────────────────────────────────────────────────────────────────────────
# Sets up swap space (prevents build OOM), installs Docker, checks out the
# 'custom-mods' branch, and prepares the Cloudflare Tunnel environment.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/bahaynes/Marinara-Engine.git"
BRANCH="custom-mods"
TARGET_DIR="${HOME}/Marinara-Engine"

echo "=== [1/5] Checking and configuring swap space ==="
TOTAL_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "${TOTAL_SWAP}" -lt 2048 ]; then
  echo "Allocating 4GB swapfile to prevent build Out-Of-Memory..."
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  fi
  echo "Swap configured: $(free -h | awk '/^Swap:/ {print $2}')"
else
  echo "Adequate swap already available (${TOTAL_SWAP}MB)."
fi

echo "=== [2/5] Installing Docker and prerequisites ==="
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg git
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo "Docker installed successfully."
else
  echo "Docker already installed."
fi

echo "=== [3/5] Syncing repository (${BRANCH}) ==="
if [ ! -d "${TARGET_DIR}" ]; then
  git clone -b "${BRANCH}" "${REPO_URL}" "${TARGET_DIR}"
else
  cd "${TARGET_DIR}"
  git fetch origin "${BRANCH}"
  git checkout "${BRANCH}"
  git pull origin "${BRANCH}"
fi

cd "${TARGET_DIR}"

echo "=== [4/5] Initializing deployment environment ==="
ENV_FILE="${TARGET_DIR}/deploy/gcp/.env"
if [ ! -f "${ENV_FILE}" ]; then
  cp "${TARGET_DIR}/deploy/gcp/.env.cloud.example" "${ENV_FILE}"
  # Generate secure random defaults for auth
  RAND_PASS=$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9' | head -c 16)
  RAND_SECRET=$(openssl rand -hex 32)
  sed -i "s/BASIC_AUTH_PASS=change-me-to-a-secure-password/BASIC_AUTH_PASS=${RAND_PASS}/" "${ENV_FILE}"
  sed -i "s/ADMIN_SECRET=generate-random-secret-here/ADMIN_SECRET=${RAND_SECRET}/" "${ENV_FILE}"
  echo "Created ${ENV_FILE} with auto-generated secure credentials."
fi

echo "=== [5/5] Building custom-mods container image ==="
# Using sudo docker in case group membership hasn't refreshed in this shell session
sudo docker compose -f deploy/gcp/docker-compose.cloud.yml build

echo ""
echo "=========================================================================="
echo " Marinara Engine (${BRANCH}) build complete!"
echo "=========================================================================="
echo ""
echo "NEXT STEPS:"
echo "1. Edit the environment file with your Cloudflare Tunnel token & hostname:"
echo "   nano ${ENV_FILE}"
echo ""
echo "   Make sure to set:"
echo "   - TUNNEL_TOKEN (from Cloudflare Zero Trust dashboard)"
echo "   - TRUSTED_HOSTS (e.g. marinara.yourdomain.com)"
echo "   - CSRF_TRUSTED_ORIGINS (e.g. https://marinara.yourdomain.com)"
echo ""
echo "   Auto-generated credentials in ${ENV_FILE}:"
grep -E '^(BASIC_AUTH_USER|BASIC_AUTH_PASS|ADMIN_SECRET)=' "${ENV_FILE}" || true
echo ""
echo "2. Start Marinara + Cloudflare Tunnel in the background:"
echo "   cd ${TARGET_DIR} && sudo docker compose -f deploy/gcp/docker-compose.cloud.yml up -d"
echo ""
echo "3. View logs at any time:"
echo "   sudo docker compose -f deploy/gcp/docker-compose.cloud.yml logs -f"
echo "=========================================================================="

