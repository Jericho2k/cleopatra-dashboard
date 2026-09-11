/**
 * Placeholder public Supabase config for the test environment.
 *
 * These are the NEXT_PUBLIC_* values a browser would already hold; they are not
 * secrets and they are never used to reach a real project, because every test
 * that exercises network code stubs fetch. Their only job is to let
 * lib/supabase.ts construct its client at import time.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.NEXT_PUBLIC_API_URL ??= 'https://backend.test'
process.env.NEXT_PUBLIC_API_KEY ??= 'test-dashboard-secret'
