# Hosting Marinara Engine ('custom-mods') on GCP with Cloudflare Tunnel

This guide walks you through deploying your **`custom-mods`** version of Marinara Engine on a temporary Google Compute Engine (GCE) VM connected securely via **Cloudflare Tunnel (`cloudflared`)**.

Zero open firewall ports are required on GCP. All traffic is encrypted over HTTPS through Cloudflare, protected by HTTP Basic Auth and Marinara Admin Access.

---

## 1. Create the GCP VM

You can create the VM in 30 seconds using **Google Cloud Shell** (click the `>_` icon at the top of the GCP console) or your local terminal with `gcloud`:

```bash
gcloud compute instances create marinara-nomad \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud
```

> [!TIP]
> - **Cost**: An `e2-small` is ~\$7/month (pennies per day while nomadic). An `e2-micro` with 30GB disk in `us-central1` is covered by GCP's **Always Free** tier.
> - **Firewall**: You do **NOT** need to allow HTTP/HTTPS traffic in GCP firewall settings. Cloudflare Tunnel establishes an outbound-only connection to Cloudflare's edge.

Connect to the VM via SSH:

```bash
gcloud compute ssh marinara-nomad --zone=us-central1-a
```
*(Or click the **SSH** button in the GCP Cloud Console Compute Engine table).*

---

## 2. Run the Automated Setup Script

Once inside the VM, run the setup script:

```bash
git clone -b custom-mods https://github.com/bahaynes/Marinara-Engine.git ~/Marinara-Engine
cd ~/Marinara-Engine
chmod +x deploy/gcp/*.sh
./deploy/gcp/setup-vm.sh
```

What this script handles automatically:
1. Allocates a **4GB swapfile** so `pnpm build` in the multi-stage Docker build never runs out of RAM.
2. Installs the latest Docker Engine and Docker Compose.
3. Checks out the `custom-mods` branch.
4. Generates secure random credentials for Basic Auth and `ADMIN_SECRET` into `deploy/gcp/.env`.
5. Compiles and builds the `marinara-engine:custom-mods` Docker image locally on the VM.

---

## 3. Configure Cloudflare Tunnel

1. Go to the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/).
2. Navigate to **Networks** > **Tunnels** > **Add a tunnel**.
3. Select **Cloudflared**, name it (e.g. `marinara-nomad`), and click **Next**.
4. Under **Install and run a connector**, click **Docker**.
5. Copy the long token string shown in the box (`eyJhIjoi...`).
6. In the **Public Hostnames** tab of the tunnel:
   - **Subdomain**: `marinara` (or whatever you prefer, e.g. `chat`)
   - **Domain**: `yourdomain.com`
   - **Type**: `HTTP`
   - **URL**: `marinara:7860`
7. Save the hostname.

---

## 4. Set Environment Variables & Launch

On the VM, edit `~/Marinara-Engine/deploy/gcp/.env`:

```bash
nano ~/Marinara-Engine/deploy/gcp/.env
```

Ensure these values are configured:

```ini
# Paste your token from Cloudflare Zero Trust
TUNNEL_TOKEN=eyJhIjoi...

# Your chosen tunnel hostname (must match the Cloudflare public hostname)
TRUSTED_HOSTS=marinara.yourdomain.com
CSRF_TRUSTED_ORIGINS=https://marinara.yourdomain.com

# Review or customize the auto-generated credentials:
BASIC_AUTH_USER=nomad
BASIC_AUTH_PASS=YourGeneratedPassword
ADMIN_SECRET=YourGeneratedAdminSecret
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

Now launch the stack in the background:

```bash
cd ~/Marinara-Engine
sudo docker compose -f deploy/gcp/docker-compose.cloud.yml up -d
```

Check the logs to verify everything is running:

```bash
sudo docker compose -f deploy/gcp/docker-compose.cloud.yml logs -f
```

You should see:
- `marinara` listening on `http://0.0.0.0:7860`
- `cloudflared` connected to Cloudflare edge with status `INF Connection ... registered`

---

## 5. Accessing from Your Nomadic Devices

1. Open your browser on your phone, tablet, or laptop:
   ```text
   https://marinara.yourdomain.com
   ```
2. When the browser prompts for credentials, enter your `BASIC_AUTH_USER` and `BASIC_AUTH_PASS`.
3. In Marinara Engine:
   - Go to **Settings** > **Advanced** > **Admin Access**.
   - Paste your `ADMIN_SECRET` into the input field and click **Save**.
   - You now have full remote admin privileges (data export, connection management, runtime configuration).
4. All `custom-mods` features are available:
   - D&D 5.5e Tabletop Combat Engine & Tactical Battlemap
   - Live Connection Quota Polling & HUD Telemetry
   - Session Summary Sliding Window & Context Depth UI
   - GLM 5.x Thinking parameter controls

---

## 6. Returning Home: Export Data & Teardown

When your power poles are reinstalled and your home server is back online:

### 1. Export Cloud Data
SSH into the GCP VM and run:

```bash
cd ~/Marinara-Engine
./deploy/gcp/export-data.sh
```

This creates an archive at `~/marinara-nomadic-backup-<timestamp>.tar.gz` containing all chats, characters, and uploads.

### 2. Download to Your Local Machine
From your local laptop terminal:

```bash
gcloud compute scp marinara-nomad:~/marinara-nomadic-backup-*.tar.gz ./ --zone=us-central1-a
```

### 3. Restore on Your Home Server
Extract the archive into your home server's Marinara data directory or Docker volume:

```bash
tar -xzf marinara-nomadic-backup-*.tar.gz -C /path/to/home/marinara-data/
```

### 4. Delete the GCP VM
Once data is verified on your home server, delete the VM so you incur no further charges:

```bash
gcloud compute instances delete marinara-nomad --zone=us-central1-a
```
Delete or re-route the tunnel in your Cloudflare Zero Trust dashboard.

