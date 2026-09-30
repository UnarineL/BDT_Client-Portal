# Client questionnaire portal

An online version of your Customer Questionnaire that runs on **your own domain**.

- **Clients** open one link, fill in the form, upload their logo / images / documents, sign, and submit.
- **You and your team** sign in at `/admin` to see every submission, open the answers and files, edit or
  delete entries, add new ones by hand, set a status, add internal notes, and export everything to CSV.
- Everything is stored in a database (Supabase). Files are stored privately. Only people you list as staff can see them.

There is nothing to install or build. It is plain HTML and JavaScript, so it works on Vercel, Netlify,
Cloudflare Pages, or ordinary cPanel hosting.

```
index.html          client form            (your-domain.com)
admin.html          staff dashboard        (your-domain.com/admin)
config.js           your Supabase keys and optional logo / brand name
questionnaire.js    the questions (edit here to change wording or options)
form.js, admin.js   the logic
styles.css          the look
supabase-setup.sql  creates the database, file storage and security rules
vercel.json         makes /admin work on Vercel and adds security headers
```

---

## Setup (about 20 minutes)

### 1. Create the database (Supabase, free to start)

1. Go to <https://supabase.com>, sign up, and click **New project**. Choose a region close to your clients and save the database password somewhere safe.
2. When the project is ready, open **SQL Editor** and click **New query**.
3. Open `supabase-setup.sql` from this folder. **Change `you@yourcompany.com`** near the top to the email address you will sign in with (add more staff emails as extra lines if you like).
4. Paste the whole file into the editor and click **Run**. You should see "Success".

### 2. Create your staff login

1. In Supabase go to **Authentication > Users > Add user > Create new user**.
2. Enter the **same email** you put in the SQL file, choose a strong password, and tick **Auto Confirm User**.
3. Go to **Authentication > Sign In / Providers** (labelled "Providers" in some versions) and **turn off "Allow new users to sign up"**. Your staff logins are created by you here, never by visitors.

To add another staff member later: create their user here, then run
`insert into public.staff (email) values ('their@email.com');` in the SQL Editor.

### 3. Connect the site to your database

1. In Supabase open **Project Settings > API** (or the **Connect** button).
2. Copy the **Project URL** and the **anon / publishable key**.
3. Open `config.js` and paste them in. Optionally set `BRAND_NAME` or `LOGO_URL`.

> Only ever use the anon / publishable key. Never paste the `service_role` / secret key into these files.

### 4. Put it online on your domain

Pick one.

**Option A: Vercel**
1. Put this folder in a GitHub repository (or use the Vercel CLI: run `npx vercel` inside the folder).
2. On <https://vercel.com>, click **Add New > Project**, import the repository, leave **Framework Preset** as **Other**, leave the build command and output directory empty, and click **Deploy**.
3. In the project go to **Settings > Domains**, add your domain (for example `forms.yourcompany.com`), and create the DNS record Vercel shows you at your domain registrar.

**Option B: Your existing website hosting (cPanel or similar)**
Upload every file in this folder into a folder on your hosting, for example `public_html/questionnaire`. Then your links are
`https://yourdomain.com/questionnaire/` and `https://yourdomain.com/questionnaire/admin.html`.

**Option C: Netlify**
Drag this folder onto <https://app.netlify.com/drop>, then add your domain under **Domain management**.

### 5. Test it before sending it to clients

1. Open your link in a private / incognito window, fill in a test (company name, a signature, upload a small image), and submit.
2. Open `/admin` (or `admin.html`), sign in, and confirm the test shows up with its file.
3. Open it, try **Edit**, change the status, then **Delete** the test.

---

## Your links

| Who | Link |
| --- | --- |
| Clients (blank form) | `https://your-domain.com/` |
| Staff dashboard | `https://your-domain.com/admin` |

Every visit to the client link is a fresh blank form, so it doubles as the empty template.

## Things worth knowing

- **Free plan limits.** As far as I know, Supabase's free plan gives 500 MB of database, 1 GB of file storage, and pauses projects that get no activity for about a week. Free plans also have no automatic backups. For real client work, the paid plan is worth it. Check <https://supabase.com/pricing> for current terms.
- **File size.** 25 MB per file, up to 10 files per upload box. Clients are told to share large videos as a link. To change the limit, edit `MAX_FILE_MB` in `questionnaire.js` **and** the `26214400` number in `supabase-setup.sql` (then run that part again).
- **Spam.** The form has a hidden trap that catches simple bots. If you start getting junk, add Cloudflare Turnstile (free) in front of the submit button.
- **Passwords.** The form tells clients not to type passwords. Keep it that way. Collect access details through a secure channel.
- **Backups.** Use **Export all (CSV)** in the dashboard regularly, and back up the file storage separately if the files matter.
- **Changing questions.** Edit the `SECTIONS` list in `questionnaire.js`. Old submissions keep their answers, and new questions simply show "No answer" on them.
- **Privacy.** This collects business contact details and signed declarations. Add a link to your privacy policy on the page if your compliance rules (such as POPIA or GDPR) require it.
