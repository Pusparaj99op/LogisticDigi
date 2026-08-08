# CodeRush 2.0 | Team Project Repository

<!-- Buttons: quick links -->
<p align="left">
  <a href="https://logisticdigi.vercel.app/"><img src="https://img.shields.io/badge/LogisticDigi%20Live-FFD400?style=for-the-badge&logo=vercel&logoColor=black&labelColor=FFD400" alt="LogisticDigi Live" /></a>
  <a href="https://veldar-gray.vercel.app/"><img src="https://img.shields.io/badge/CodeRush%202.0%20Web-00E5FF?style=for-the-badge&logo=vercel&logoColor=black&labelColor=00E5FF" alt="CodeRush 2.0 Web" /></a>
  <a href="https://github.com/Pusparaj99op/LogisticDigi"><img src="https://img.shields.io/badge/LogisticDigi%20Repo-24292e?style=for-the-badge&logo=github&logoColor=white&labelColor=24292e" alt="LogisticDigi Repo" /></a>
  <a href="https://github.com/Pusparaj99op/CodeRush2.0_CoDevians_INF-03"><img src="https://img.shields.io/badge/CodeRush%202.0%20Repo-FF5A00?style=for-the-badge&logo=github&logoColor=white&labelColor=FF5A00" alt="CodeRush 2.0 Repo" /></a>
</p>

## Project Information

* Team Name: CoDevians
* Project Title: INF-03: Composite Agentic Travel & E-Commerce Orchestrator + LogisticDigi
* Track/Theme: INF-03

## Project Description

LogisticDigi is a full-stack monorepo that connects an **AI orchestrator** to a **live operations dashboard**. The AI continuously runs procurement workflows in the background — negotiating with[...]

Think of it as an "autopilot for your supply chain" that still asks permission before spending big.

---

## Technical Stack

* Frontend: Next.js, GSAP, Framer Motion, Three.js, Three-globe, Tailwind CSS
* Backend: Firebase Functions, TypeScript, Firebase Admin
* Database: Cloud Firestore, SQL Server
* Tools/APIs: Algorand SDK (`algosdk`), Google Gemini API, Android SDK (Logistic and Tracking Mobile App)
* Payments: x402 with Zerion Payments
* AI / LLM: Anthropic Claude (cloud), Ollama (local fallback)
* Deployment: Vercel (web), Firebase (auth + database)


### 1. Clone and install

```bash
git clone https://github.com/pusparaj99op/LogisticDigi.git
cd LogisticDigi
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Firebase Console → Project Settings → Web App |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Project Settings → Service Accounts → Generate new key |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | [mapbox.com](https://www.mapbox.com) (free tier) |
| `FACILITATOR_MNEMONIC` | Generate an Algorand wallet and fund it from the [TestNet faucet](https://bank.testnet.algorand.network) |

### 3. Run the web app

```bash
pnpm dev
```

Opens at [http://localhost:3000](http://localhost:3000). Sign in with Google and you'll land on the operations dashboard.

### 4. Provision your account (first time only)

After signing in, run this once to give your account access to a workspace:

```bash
pnpm --filter @logisticdigi/orchestrator run provision -- \
  --email you@gmail.com --tenant tenant_a --role owner
```


### 5. Start the orchestrator

This is the background process that actually runs procurement scenarios and writes to Firestore:

```bash
pnpm --filter @logisticdigi/orc. 
---

## Team Members

<table align="center">
  <tr>
    <td align="center">
      <img src="./ProfilePhotos/Pranay%20Gajbhiye.png" width="150" alt="Pranay Gajbhiye"/><br />
      <b>Pranay Gajbhiye</b>
    </td>
    <td align="center">
      <img src="./ProfilePhotos/Rasika%20Pande.jpg" width="150" alt="Rasika Pande"/><br />
      <b>Rasika Pande</b>
    </td>
    <td align="center">
      <img src="./ProfilePhotos/Soham%20Pise.png" width="150" alt="Soham Pise"/><br />
      <b>Soham Pise</b>
    </td>
    <td align="center">
      <img src="./ProfilePhotos/Vikramaditya%20Kambani.png" width="150" alt="Vikramaditya Kambani"/><br />
      <b>Vikramaditya Kambani</b>
    </td>
    <td align="center">
      <img src="./ProfilePhotos/Vineet%20Mandhalkar.png" width="150" alt="Vineet Mandhalkar"/><br />
      <b>Vineet Mandhalkar</b>
    </td>
  </tr>
</table>
