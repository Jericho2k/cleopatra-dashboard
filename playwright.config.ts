import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3210',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'OPERATOR_E2E_HARNESS=1 NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key npm run dev -- --hostname 127.0.0.1 --port 3210',
    url: 'http://127.0.0.1:3210/e2e-operator-flows',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
