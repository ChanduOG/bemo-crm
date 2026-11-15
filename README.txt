IKUSASA OPERATIONS OS - LIVE EDITION
====================================

This edition contains no sample data. It opens on a setup screen where you add your company
and yourself as the owner, then you add your own team, clients, enquiries, quotes, invoices,
projects, tasks, expenses and retainers.

HOW TO RUN
  Double-click index.html (Chrome or Edge recommended). No installation or server needed.
  An internet connection is needed for the font and icons.

WHERE YOUR DATA LIVES - READ THIS
  - Records are saved in this browser, on this computer (browser local storage).
  - Uploaded document files are saved in the browser's file storage (IndexedDB).
  - Clearing browser data, using a private window, or switching browser/computer means
    you will not see your data there.
  - Export a backup at least weekly: Administration > Backup & data > Export backup.
    Restore it on another computer from the setup screen or the same page.
    Backups contain all records but not uploaded document files - keep the originals.
  - Always open the same index.html file from the same folder; moving the folder can
    make the browser treat it as a different site.

WHAT IS REAL vs. WHAT NEEDS A BACK END
  Works now: CRM, inbox (manual logging), discovery, assessments, quotes, invoices,
  payments, projects, workstreams, tasks, team workload, finance (expenses, retainers),
  documents, communications log, analytics, audit log, CSV client import, backups.

  Rule-based: enquiry classification and requirement extraction from call notes.

  TEAM & ROLES (Administration > Team members)
    Roles: Owner, Admin, Team leader, Sales, Delivery, Finance, Read-only. Each role gets its own
    home page ("My portal") and menu. Set "Reports to" to put people in a team leader's team.
    Until sign-in exists, each person picks themselves from the profile menu ("Working as").
  TASK POOL: new leads go to the Sales pool (or auto-assign - Administration > Workflow & reminders).
    Every rep is notified; the first to click Claim owns the lead and the client. Leaders can assign.
  REMINDERS: quote follow-ups and invoice chasing are created automatically and repeat until the
    quote is decided / invoice paid. Ignored reminders and overdue tasks are reported to the team leader.
    With the n8n connection on, everyone also gets a daily reminder email.
  SENDING: Send quote / Send invoice email the client through n8n (or open your email app),
    and Print / PDF saves a copy. Every action is stamped with who did it.
  DELETING: Owner and Admin can delete any record (bin icon), or whole record types under
    Administration > Backup & data. Give other roles "Delete" in Roles & permissions.

  Needs a back end (next phase): shared multi-user access and sign-in (Supabase Auth),
  sending email/WhatsApp from the app, receiving enquiries automatically (n8n),
  call recording, and live integration syncing. Until then, messages are logged here and
  sent from your normal email/WhatsApp, and integration status is recorded manually.

FILES
  index.html      App shell and design system
  js/data.js      Data model and configuration (statuses, IES phases, templates) - no records
  js/core.js      Storage, router, components, charts, search
  js/views-a.js   Command Centre, CRM, inbox, discovery
  js/views-b.js   Assessments, quotes, invoices, projects, tasks, team
  js/views-c.js   Finance, communications, documents, integrations, analytics, admin, setup
  js/ops.js       Roles & portals, task pool, reminders, sending quotes/invoices, deleting
