# Run AGNES on your phone — Termux guide

MINEMIND-DEEP runs on Android in Termux. That puts the bot and your Minecraft
world on the **same device**, so `localhost:3344` genuinely works.

---

## Step 0 — Install Termux (once)

Use the **F-Droid** build. Do **not** use the Play Store version — it is broken
(it has no `pkg` command).

<https://f-droid.org/packages/com.termux/>

---

## Step 1 — First-time Termux setup (once)

```bash
pkg update -y
pkg install -y nodejs-lts git
node -v
```

`node -v` must print **v18 or newer**. If it prints nothing, the package failed —
reopen Termux and run `pkg install nodejs-lts` again.

---

## Step 2 — Get the project

The runtime is a small archive (25 KB). Transfer it to the phone using **Step 2A**
(easiest) or **Step 2B** (if you pushed it to GitHub).

### Step 2A — Paste the installer into Termux

```bash
mkdir -p ~/agnes && cd ~/agnes
nano install.sh
```

Paste the installer script from the chat into `nano`, then:

- `Ctrl + O` then `Enter` to save
- `Ctrl + X` to exit

Then run it:

```bash
bash install.sh
```

It unpacks the project and installs dependencies.

### Step 2B — From GitHub

```bash
cd ~
git clone <YOUR-REPO-URL> MINEMIND-DEEP
cd MINEMIND-DEEP
npm install
```

---

## Step 3 — Add your Gemini API key

```bash
cd ~/MINEMIND-DEEP
nano .env
```

Put this in the file (use your own key):

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
```

Save: `Ctrl + O`, `Enter`, `Ctrl + X`.

---

## Step 4 — Check everything is OK

```bash
npm run doctor
```

You want to see:

```
OK   node version
OK   GEMINI_API_KEY present
OK   provider ready (model: gemini-3.5-flash)
```

If it says the key is missing, your `.env` is wrong — go back to Step 3.

---

## Step 5 — Open your Minecraft world on port 3344

In **Zlith**:

1. Open Minecraft Java **1.21.11**
2. Load or create a **singleplayer** world
3. Pause → **Open to LAN**
4. Set the port to **3344**
5. Press **Start LAN World**

The LAN screen shows "Local game hosted on port 3344".

> Minecraft's LAN normally picks a random port. You must set it to 3344 so the
> bot finds it. If Zlith's LAN screen does not let you choose the port, note the
> port it shows and set `port` in `config/settings.json` to match.

**On the same phone, both the world and the bot use the phone's own
`localhost`, so this works.**

---

## Step 6 — Run AGNES

In Termux:

```bash
cd ~/MINEMIND-DEEP
npm start
```

Watch for:

```
Target reachable
AGNES spawned
```

Then AGNES is in your world, deciding what to do through Gemini.

Stop it with `Ctrl + C`.

---

## Everyday commands

```bash
cd ~/MINEMIND-DEEP      # go to the project
npm start               # run AGNES
npm run doctor          # check the setup
npm test                # run the tests
```

Open the LAN world **first**, then run `npm start`. If you close the world, AGNES
retries every 5 seconds and reconnects when you open it again.

---

## Problems

**"Target not reachable"**
The Minecraft world is not open. Open it to LAN on port 3344 first. Confirm the
port with `npm run doctor`.

**"Invalid username" / kicked on join**
Online-mode servers need a real Microsoft account. For a LAN world on your own
phone, keep `auth: offline` in `config/settings.json`.

**Nothing happens, no decisions**
Look for `quota exceeded`. The Gemini free tier allows only about 20 requests
per minute. AGNES is set to 5 decisions per minute. If you see repeated quota
errors, wait a minute or use a key with billing enabled.

**Wrong port**
Check the port Zlith shows on the LAN screen and match it in
`config/settings.json`.

---

## What AGNES actually does

It is not a scripted bot. Each decision tick:

1. **Observes** the real world — health, food, position, nearby mobs, blocks,
   inventory, time of day.
2. **Asks Gemini** to pick one action from a fixed set: `attack`, `flee`,
   `mine`, `eat`, `explore`, `follow`, `craft`, `sleep`, `idle`.
3. **Governs** the choice — vetoes mining bedrock, drops below 6 HP, attacks the
   owner, or walks below Y −59.
4. **Executes** the action through real mineflayer calls.

If Gemini is unreachable, AGNES performs **no gameplay actions at all** — it
waits rather than falling back to canned behaviour. `npm run verify:antifake`
proves this.
