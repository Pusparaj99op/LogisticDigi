# CodeRush 2.0 | Team Project Repository

## Project Information

* Team Name: CoDevians
* Project Title: INF-03: Composite Agentic Travel & E-Commerce Orchestrator + LogisticDigi
* Track/Theme: INF-03

## Project Description

LogisticDigi is a full-stack monorepo that connects an **AI orchestrator** to a **live operations dashboard**. The AI continuously runs procurement workflows in the background — negotiating with freight providers, tracking budgets, and settling payments on the Algorand blockchain. When a decision crosses a budget threshold, it pauses and waits for a human operator to approve or reject it through the web or mobile app.

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

Without this step, you'll be signed in but the dashboard will be empty — Firestore security rules won't let your account read the data until your claims are set.

### 5. Start the orchestrator

This is the background process that actually runs procurement scenarios and writes to Firestore:

```bash
pnpm --filter @logisticdigi/orchestrator run worker
```

Within a few seconds, the Floor, Approvals, and Ledger tabs on the dashboard should start filling in. The orchestrator runs a new procurement scenario every 5 seconds, pausing when it hits an approval gate.

## License

MIT — see [LICENSE](./LICENSE)
