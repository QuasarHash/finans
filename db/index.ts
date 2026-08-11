// The family center uses Supabase for production persistence.
// Cloudflare D1 remains intentionally disabled in .openai/hosting.json.
export const persistenceProvider = "supabase" as const;
