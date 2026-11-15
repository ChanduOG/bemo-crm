# Putting the CRM online (Supabase + Cloudflare Pages)

**What you'll have at the end:** the CRM at `https://crm.bemosolutions.co.za`. Every team member signs in with their own email and password, on any device. Everyone sees the same data live. A daily job stops the free Supabase project from going to sleep.

- **Cost:** R0. Supabase, GitHub and Cloudflare Pages are all on their free plans.
- **Time:** about 45 minutes.

---

## Step 0: Make a safety copy first (2 min)

1. Open `crm\index.html` the way you normally do.
2. Go to **Administration → Backup & data → Export backup**.
3. Keep the `.json` file somewhere safe.

---

## Step 1: Create the database (10 min)

1. Go to **supabase.com** and click **Start your project**. Sign in with GitHub. You'll need a GitHub account anyway; if you don't have one, create it at github.com first.
2. Click **New project** and fill it in:
   - **Name:** `bemo-crm`
   - **Database password:** click **Generate** and save it in your password manager
   - **Region:** *West EU (London)* or *Central EU (Frankfurt)*. These are the closest to South Africa.
3. Click **Create new project** and wait about 2 minutes until it's ready.
4. In the left menu, open **SQL Editor** and click **+ New query**.
5. Open `crm\supabase\1-setup.sql` in Notepad. Select all, copy, paste it into the editor, then click **Run**.
   - You should see **"Success. No rows returned"**.
6. Open **Authentication → Sign In / Providers**.
   - Turn **OFF** "Allow new users to sign up". This means strangers can't create accounts.
   - Leave **Email** turned on.
   - Click **Save**.
7. Open **Authentication → Users → Add user → Create new user**.
   - Enter **your** work email and a password.
   - Tick **Auto Confirm User** and click **Create user**.
8. Copy two values, from **Project Settings → API Keys** (or the green **Connect** button at the top):
   - **Project URL.** It looks like `https://abcdefghijk.supabase.co`.
   - **anon public key.** It's a long key starting with `eyJ...`, on the **"Legacy API keys"** tab. If you only see a **publishable** key (`sb_publishable_...`), use that instead.
   - ⚠️ **Never** copy the `service_role` or `secret` key anywhere.
9. Open `crm\js\cloud-config.js` in Notepad and paste the two values between the quotes:
   ```js
   url:     'https://abcdefghijk.supabase.co',
   anonKey: 'eyJhbGciOi...your key...',
   ```
   Save the file.

---

## Step 2: Move your existing data up (3 min)

1. Open `crm\index.html` again, in the same browser as always. You'll now see a **Sign in** screen.
2. Sign in with the email and password from Step 1, part 7.
3. The CRM says the online database is empty and offers to upload this browser's data. Click **Upload my data**.
4. You're in. A small **"Saved"** label at the bottom-right shows that everything is stored online.

> **If that screen doesn't appear** (for example, on a different computer), the CRM shows the setup page instead. Click **Restore a backup** and pick the `.json` file from Step 0. Either way, your sign-in email automatically becomes the Owner account.

---

## Step 3: Put the code on GitHub, privately (10 min)

1. On **github.com**, click **New repository**.
   - **Name:** `bemo-crm`
   - Choose **Private**. This matters: private repos never have their daily job switched off.
   - Click **Create repository**.
2. Open PowerShell and run these commands, one at a time. Replace `YOUR-GITHUB-NAME` with your GitHub username.
   ```
   cd "C:\Users\Emeka Mokotjo\Downloads\BEMO-SOLUTIONS Website\crm"
   git init
   git add -A
   git commit -m "CRM online"
   git branch -M main
   git remote add origin https://github.com/YOUR-GITHUB-NAME/bemo-crm.git
   git push -u origin main
   ```
3. In the repo on GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**. Add two secrets:
   - `SUPABASE_URL`: your Project URL
   - `SUPABASE_ANON_KEY`: your anon or publishable key
4. Test the keep-alive job:
   - Open the **Actions** tab.
   - Click **Keep Supabase awake**, then **Run workflow**.
   - After about 30 seconds you should see a green tick ✅. The log says `HTTP 200 - "ok ..."`.

---

## Step 4: Host it at crm.bemosolutions.co.za (10 min)

1. Go to **dash.cloudflare.com** and sign up (free).
2. Open **Workers & Pages → Create → Pages** tab, then **Connect to Git**.
   - Pick GitHub and allow access to **bemo-crm** only.
3. Fill in the settings:
   - **Project name:** `bemo-crm`
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** leave empty, or type `/`
   - Click **Save and Deploy**.
   - About a minute later it's live at `https://bemo-crm.pages.dev`.
4. Add your own address:
   - In the project, open **Custom domains → Set up a custom domain** and type `crm.bemosolutions.co.za`.
   - In **GoDaddy → DNS → Add record**, add:
     - **Type:** CNAME
     - **Name:** `crm`
     - **Value:** `bemo-crm.pages.dev`
     - **TTL:** 1 hour
   - Wait until Cloudflare shows **Active**. This takes 5 to 30 minutes, and the padlock (HTTPS) is automatic.
5. Back in Supabase, open **Authentication → URL Configuration**.
   - Set **Site URL** to `https://crm.bemosolutions.co.za`.
   - Click **Save**.

**From now on, updating the CRM** means running these 3 commands in the `crm` folder. Cloudflare publishes the change within a minute.
```
git add -A
git commit -m "update"
git push
```

---

## Step 5: Add your team (2 min per person)

1. In the CRM, open **Administration → Team members → Add**.
   - Enter their name and their **exact** work email.
   - Set their role (Sales, Team leader, …) and who they report to.
2. In Supabase, open **Authentication → Users → Add user → Create new user**.
   - Use the **same email** and a temporary password.
   - Tick **Auto Confirm User**.
3. Send them `https://crm.bemosolutions.co.za` and the temporary password.
4. After their first sign-in, they change the password from the **profile menu → Change my password**.

To remove someone, delete them in both places: the CRM team list and Supabase Users. Anyone signed in who isn't on the CRM's team list is blocked from seeing any data. The database itself enforces this, not just the screen.

---

## Step 6: Reconnect the website leads (1 min)

1. Open **Intake Inbox** and click the **plug icon**.
2. Paste your n8n URL and CRM key, then click **Save & sync**.

Online, this connection is shared, so you only do it once for the whole team.

---

## How the "don't go to sleep" protection works

Free Supabase projects **pause after 7 days with no activity**. Three things keep yours awake:

| Layer | What it does |
|---|---|
| **GitHub Action** (`.github/workflows/keep-supabase-awake.yml`) | Pings the database every day at 06:17, plus a backup ping on Wednesdays. It retries 5 times if Supabase is slow. GitHub emails you if it ever fails. |
| **The CRM itself** | Every time anyone signs in, it records a ping. |
| **Optional extra: cron-job.org** (free) | See the setup below. Only needed if you want a second, independent pinger. |

To set up cron-job.org:

1. Create a cron job with these settings:
   - **URL:** `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/keepalive`
   - **Method:** POST
   - **Headers:** `apikey: YOUR-ANON-KEY` and `Content-Type: application/json`
   - **Body:** `{"p_source":"cronjob"}`
   - **Schedule:** daily
2. The ping also clears out old pings, and empties the recycle bin of anything deleted more than 90 days ago.

**To check that the pings are arriving**, run this in Supabase **SQL Editor**:
```sql
select * from keepalive order by id desc limit 10;
```

**If it ever does pause:** open the Supabase dashboard and click **Restore project**. Your data is kept.

---

## Good to know

- **Deleted something by mistake?** Everything deleted is kept for 90 days. Run `crm\supabase\2-restore-deleted.sql` in the SQL Editor to find and restore it.
- **Backups:** the free plan has **no automatic backups**. Do **Administration → Backup & data → Export backup** once a week and keep the files in Google Drive or OneDrive.
- **Reminders and emails:** the reminder engine, escalations, daily reminder emails and the website lead sync run in **one** open browser at a time, so nobody gets duplicates. If nobody has the CRM open, they catch up the next time someone does.
- **"Saved" label (bottom-right):** "Saving…" means changes are uploading. **"Not saved – retrying"** in red means there's no connection; leave the tab open and it retries by itself.
- **Free-plan limits:** 500 MB of data, which is years of records for a team your size. If you outgrow it, the Pro plan is $25/month.
- **The anon key in `cloud-config.js` is meant to be public.** The database rules only let signed-in team members in. The `service_role` key must **never** go in any file.
- **POPIA:** the data is stored in the EU region you picked. Mention "cloud hosting in the EU (Supabase)" in your privacy policy.
