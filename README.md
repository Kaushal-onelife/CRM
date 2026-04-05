# Water Purifier CRM Backend

This backend is now configured for real Supabase data only. Mock data and in-memory fallbacks have been removed.

## Environment

Create `Backend/.env` from `Backend/.env.example` and fill in:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` (optional)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (optional, only for push notifications)

## Database setup

Run the SQL in [schema.sql](/d:/Projects/CRM/Backend/supabase/schema.sql) inside your Supabase SQL editor.

## Run

```bash
npm install
npm run dev
```

The API will fail fast at startup if required Supabase environment variables are missing.
