# Water Purifier CRM

Multi-tenant SaaS CRM for water purifier service businesses. Each business signs up as a tenant and manages their own customers, services, AMC contracts, inventory, and bills in isolation via Supabase RLS.

## Stack

- **Frontend** ([frontend/](frontend/)) — React Native + Expo (~55), NativeWind/Tailwind, React Navigation v7. Targets Android, iOS, web.
- **Backend** ([src/](src/)) — Node.js + Express 5, Supabase (Postgres + Auth), Firebase Admin (FCM push), node-cron.

## Setup

### 1. Database
Run [supabase/schema.sql](supabase/schema.sql) in your Supabase SQL editor. The schema includes RLS policies for tenant isolation.

### 2. Backend
```bash
cp .env.example .env
# fill in real values — never commit .env
npm install
npm run dev
```

Required env vars (server fails fast at startup if any are missing):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:
- `PORT` (default 5000)
- `NODE_ENV` (default development)
- `CORS_ORIGINS` — comma-separated allowlist; required in production
- `CRON_TIMEZONE` — defaults to `Asia/Kolkata`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — only needed for FCM push

### 3. Frontend
```bash
cd frontend
npm install
# create frontend/.env or pass vars at start time:
# EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api
# EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# EXPO_PUBLIC_SUPABASE_ANON_KEY=...
npm start
```

In development the frontend falls back to a mock data mode if the Supabase env vars are missing. Production builds throw at startup if they aren't set.

## API

All routes under `/api/*`. Auth (Supabase JWT in `Authorization: Bearer ...`) is required for everything except `/api/auth/signup`, `/api/auth/login`, `/api/health`.

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login` |
| Dashboard | `GET /dashboard` |
| Customers | `GET/POST /customers`, `GET/PUT/DELETE /customers/:id` |
| Services | `GET/POST /services`, `GET/PUT /services/:id`, `PATCH /services/:id/complete`, `POST /services/generate-bill`, `GET /services/customer/:customer_id/history` |
| Bills | `GET/POST /bills`, `GET /bills/:id`, `PATCH /bills/:id/pay` |
| AMC | `GET/POST /amc`, `GET/PUT /amc/:id`, `POST /amc/check-expired` |
| Inventory | `GET/POST /inventory`, `GET/PUT/DELETE /inventory/:id` |

## Notes

- Bill numbers are unique per tenant (`UNIQUE (tenant_id, bill_number)`). The controllers retry on conflict so concurrent inserts produce distinct numbers.
- Pagination is capped at `limit=100` per request.
- Cron runs at 09:00 in `CRON_TIMEZONE` (default IST) and sends FCM reminders for services scheduled the next day.
