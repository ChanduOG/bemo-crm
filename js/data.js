/* BEMO-SOLUTIONS Operations OS — data model (live edition).
   Starts empty. Only configuration (statuses, IES phases, project templates, integration catalogue) is predefined.
   Every record is created by the people using the system. Shape maps 1:1 onto future Supabase tables. */
window.SEED_VERSION = 100;
window.TODAY = (function(){ const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();

window.STATUS = {
  client: ['New enquiry','Contact pending','Contacted','Discovery scheduled','Discovery completed','Assessment in progress','Quote preparation','Quote sent','Awaiting decision','Accepted','Payment pending','Active client','Project completed','Ongoing partnership','Lost / archived'],
  quote: ['Draft','Internal review','Sent','Viewed','Accepted','Rejected','Expired'],
  invoice: ['Draft','Issued','Partially paid','Paid','Overdue','Cancelled'],
  project: ['Awaiting authorization','Ready to start','Planning','In progress','In review','Awaiting client feedback','Blocked','Testing','Deployment','Handover','Completed','On hold'],
  task: ['Backlog','To do','In progress','In review','Blocked','Done'],
  ws: ['Not started','In progress','In review','Blocked','Done'],
  enquiry: ['Unprocessed','New','Contacted','Converted','Archived'],
  priority: ['Urgent','High','Medium','Low']
};
/* Project types are yours: typed when you create a project or quote, and kept in settings.projectTypes. */
Object.defineProperty(window.STATUS, 'categories', {enumerable:true, get(){
  const D = window.DB; if(!D || !D.settings) return [];
  const pal = ['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];
  const list = Array.from(new Set((D.settings.projectTypes||[]).concat((D.projects||[]).map(p=>p.category)).filter(Boolean)));
  if(window.CAT_COLOR) list.forEach((c,i)=>{ if(!window.CAT_COLOR[c]) window.CAT_COLOR[c] = pal[i%pal.length]; });
  return list;
}});
window.IES = [
  {n:1,name:'Discover',desc:'Understand the business, goals and constraints',del:['Enquiry summary','Discovery call record','Requirements draft']},
  {n:2,name:'Assess',desc:'Audit systems, workflows and AI readiness',del:['Systems inventory','Process maps','AI readiness score','Risk register']},
  {n:3,name:'Architect',desc:'Design the target solution and commercial scope',del:['Solution architecture','Scope of work','Quote & timeline']},
  {n:4,name:'Build',desc:'Deliver workstreams, test and review',del:['Sprint demos','Test reports','Change log']},
  {n:5,name:'Enable',desc:'Deploy, train users and hand over',del:['Deployment checklist','Training session','Handover pack']},
  {n:6,name:'Evolve',desc:'Measure outcomes and improve',del:['Usage report','Optimisation backlog']},
  {n:7,name:'Partner',desc:'Ongoing support and strategic roadmap',del:['Retainer SLA','Quarterly roadmap review']}
];

window.makeSeed = function(){
  const integrations = [
    {id:'n8n',name:'n8n',desc:'Workflow orchestration',icon:'workflow'},
    {id:'email',name:'Email provider',desc:'Microsoft 365 / IMAP & SMTP',icon:'mail'},
    {id:'whatsapp',name:'WhatsApp Business',desc:'Cloud API messaging',icon:'message-circle'},
    {id:'ai',name:'AI provider',desc:'Classification, summaries, drafting',icon:'sparkles'},
    {id:'supabase',name:'Supabase',desc:'Database, auth & storage',icon:'database'},
    {id:'github',name:'GitHub',desc:'Repositories & deployments',icon:'git-branch'},
    {id:'telephony',name:'Telephony',desc:'Call recording & transcription',icon:'phone'},
    {id:'storage',name:'Document storage',desc:'SharePoint / Google Drive',icon:'folder'}
  ].map(i=>Object.assign(i,{status:'Not connected',lastSync:null,lastError:'—',usage:'—'}));

  /* No built-in project templates: you create your own under Administration > Project templates. */
  const templates = [];

  const settings = {
    company:{website:'www.bemosolutions.co.za', name:'BEMO-SOLUTIONS (Pty) Ltd', tagline:'AI consultancy & business automation', reg:'', vatNo:'', address:'', email:'', phone:'', bank:'', infoOfficer:''},
    notif:{email:true,whatsapp:false,inapp:true,digest:true,overdue:true,mentions:true,payments:true,enquiries:true},
    security:{mfa:true,sso:false,session:'12 hours',ipAllow:false,pwdRotate:false,aiApproval:true},
    workflow:{autoAssign:true,autoClassify:true,quoteApproval:true,depositRequired:true,depositPct:40,followUpHours:24,vat:15,enquiryRouting:'pool',quoteFollowDays:3,invoiceRemindBefore:3,invoiceRepeatDays:7,escalateDays:1,emailReminders:true,poolEscalateHours:4},
    density:'comfortable',
    projectTypes:[]
  };

  return {v:window.SEED_VERSION, me:null, setupDone:false,
    users:[], clients:[], quotes:[], invoices:[], projects:[], tasks:[], enquiries:[], conversations:[], discoveries:[], assessments:[],
    workflows:[], integrations, documents:[], expenses:[], retainers:[], activity:[], notifications:[], audit:[], notes:[], reminders:[], events:[],
    settings, templates, aiChats:{}};
};
