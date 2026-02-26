# Deploying the app on a Raspberry Pi 4

This guide gets the production reporting app running on a Raspberry Pi 4 connected to your company router so it stays online whenever the Pi is powered and connected.

---

## What you’ll have at the end

- The app runs on the Pi.
- It starts automatically when the Pi boots.
- It restarts automatically if it crashes.
- Anyone on the company network can open it at `http://<pi-ip>:3000` (e.g. `http://192.168.1.50:3000`).

---

## 1. Prepare the Raspberry Pi

1. **Install Raspberry Pi OS** (e.g. Raspberry Pi OS Lite or Desktop) on an SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. **Boot the Pi**, connect it to the router with Ethernet (recommended) or Wi‑Fi, and finish the initial setup (user `pi`, password, etc.).
3. **Update the system:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
4. **Install Node.js 18 or 20** (required for the app):
   ```bash
   # Option A: from NodeSource (recommended, current LTS)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # Option B: from Raspberry Pi OS (may be older)
   sudo apt install -y nodejs npm
   ```
   Check:
   ```bash
   node -v   # e.g. v20.x.x
   npm -v
   ```

---

## 2. Copy the app onto the Pi

You only need the **source code** (no `node_modules`). Dependencies will be installed on the Pi.

**Option A: Copy from your computer with SCP**

On your **Mac** (in the folder that contains `web_app`):

```bash
cd /Users/seb/seb_applications
scp -r web_app pi@<PI-IP>:~/
```

Replace `<PI-IP>` with the Pi’s IP (e.g. `192.168.1.50`). If you don’t know it, on the Pi run `hostname -I`.

**Option B: Clone from Git**

If the project is in a Git repo:

```bash
cd /home/pi
git clone <your-repo-url> web_app
cd web_app
# if the app is in a subfolder, cd into it
```

**Option C: USB stick / shared folder**

Copy the `web_app` folder (without `node_modules`) onto the Pi into `/home/pi/web_app`.

---

## 3. Install dependencies and test on the Pi

SSH into the Pi (or use the Pi’s desktop terminal):

```bash
ssh pi@<PI-IP>
cd /home/pi/web_app
```

Install dependencies (this builds native modules like `better-sqlite3` on the Pi):

```bash
npm install --production
```

Start the app manually to confirm it runs:

```bash
npm start
```

You should see: `Server running at http://localhost:3000`. From another device on the same network, open `http://<PI-IP>:3000`. Then stop the server with `Ctrl+C`.

---

## 4. Run the app as a service (starts on boot, restarts on crash)

We use **systemd** so the app starts when the Pi boots and restarts if it exits or crashes.

1. **Copy the service file** into systemd (paths assume the app is in `/home/pi/web_app`):

   ```bash
   sudo cp /home/pi/web_app/deploy/raspberry-pi.service /etc/systemd/system/web_app.service
   ```

   If your app lives somewhere else, edit the service file first:

   ```bash
   sudo nano /etc/systemd/system/web_app.service
   ```

   Set `WorkingDirectory=` and, if needed, `User=` to match your setup.

2. **Reload systemd and enable the service:**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable web_app.service
   sudo systemctl start web_app.service
   ```

3. **Check status:**

   ```bash
   sudo systemctl status web_app.service
   ```

   You should see “active (running)”. Open `http://<PI-IP>:3000` again from a phone or PC on the network.

**Useful commands later:**

- Stop: `sudo systemctl stop web_app.service`
- Start: `sudo systemctl start web_app.service`
- Restart: `sudo systemctl restart web_app.service`
- Logs: `journalctl -u web_app.service -f`

---

## 5. Find the Pi’s IP and share the URL

- On the Pi: `hostname -I` (first address is the one to use).
- Or check the router’s “connected devices” list.

Tell users to open: **`http://<that-IP>:3000`** (e.g. `http://192.168.1.50:3000`).

**Optional: reserve the Pi’s IP** in the router (DHCP reservation) so the address doesn’t change.

---

## 5a. (Optional) Use a local name: production.log

You can use **production.log** (or any name) instead of the IP, with no domain purchase and no extra servers. Each device that should use the name needs a one-line entry in its **hosts file**. The Pi’s IP must stay fixed (use a DHCP reservation on the router).

**On each Windows PC/tablet:**

1. Open Notepad **as Administrator** (right‑click → Run as administrator).
2. Open file: `C:\Windows\System32\drivers\etc\hosts`
3. Add a line at the end (replace `192.168.1.50` with your Pi’s IP):
   ```
   192.168.1.50  production.log
   ```
4. Save and close.

**On each Mac:**

1. Edit the hosts file: `sudo nano /etc/hosts`
2. Add a line (replace `192.168.1.50` with your Pi’s IP):
   ```
   192.168.1.50  production.log
   ```
3. Save (Ctrl+O, Enter) and exit (Ctrl+X).

**On phones/tablets (iOS/Android):**  
There is no built-in way to edit a hosts file. Use the IP address for those devices, or look for a “local DNS” / “hosts” app if you really need the name on mobile.

After that, users can open **http://production.log:3000** in the browser. If the Pi’s IP ever changes, update the same line on each device.

---

## 6. Updating the app later

1. Copy the new code over (same way as in step 2), overwriting the old files in `/home/pi/web_app` (but **don’t** delete the `data/` folder if you want to keep the database).
2. On the Pi:
   ```bash
   cd /home/pi/web_app
   npm install --production
   sudo systemctl restart web_app.service
   ```

---

## Troubleshooting

| Problem | What to try |
|--------|---------------------|
| Can’t open the app from another device | Pi firewall: `sudo ufw allow 3000` (if you use ufw). Confirm the app is listening on `0.0.0.0` (default for Express). |
| App crashes on start | Run `npm start` in a terminal and read the error. Often a bad path or missing `data/` directory. |
| `npm install` fails for `better-sqlite3` | Install build tools: `sudo apt install -y build-essential python3`. Then run `npm install --production` again. |
| Service won’t start | `sudo journalctl -u web_app.service -n 50` to see errors. Check `WorkingDirectory` and paths in the service file. |

---

## Summary checklist

- [ ] Raspberry Pi OS installed and updated
- [ ] Node.js 18 or 20 installed
- [ ] App files copied to `/home/pi/web_app` (no `node_modules`)
- [ ] `npm install --production` run in `/home/pi/web_app`
- [ ] Manual `npm start` works and is reachable at `http://<PI-IP>:3000`
- [ ] `web_app.service` installed and enabled
- [ ] `sudo systemctl start web_app.service` and status is “active (running)”
- [ ] Router/network allows access to the Pi on port 3000; users use `http://<PI-IP>:3000`
- [ ] (Optional) DHCP reservation for the Pi; hosts file on each PC/Mac with `192.168.1.50  production.log` so users can use `http://production.log:3000`
