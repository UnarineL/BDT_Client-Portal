/* ---------------------------------------------------------------------
   Settings. Fill these in after creating your Supabase project.
   (Supabase dashboard -> Project Settings -> API)

   The "anon" / "publishable" key is designed to be public: the security
   rules in supabase-setup.sql are what protect your data.
   NEVER paste the "service_role" / "secret" key into this file.
   --------------------------------------------------------------------- */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // Optional branding shown at the top of the client form
  BRAND_NAME: '',   // e.g. 'Acme Web Studio'
  LOGO_URL: ''      // e.g. 'logo.png' (put the file next to index.html)
};
