export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  BOOKS_URL?: string;
  ADMIN_IDS?: string;
}
const CATALOG = "https://raw.githubusercontent.com/whispermmepub/wow-books/main/data.json";
const REPO = "whispermmepub/wow-books";

const esc=(s:any)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm=(s:any)=>String(s??"").toLowerCase().normalize("NFKC").replace(/\s+/g,"").trim();
const isAdmin=(u:any,e:Env)=>new Set((e.ADMIN_IDS||"").split(",").map(x=>x.trim())).has(String(u?.message?.from?.id||""));

async function api(e:Env,m:string,b:any){
  return fetch("https://api.telegram.org/bot"+e.TELEGRAM_BOT_TOKEN+"/"+m,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)
  });
}
async function say(e:Env,id:any,text:string){
  return api(e,"sendMessage",{chat_id:id,text,parse_mode:"HTML",disable_web_page_preview:true});
}
async function init(e:Env){
  await e.DB.batch([
    e.DB.prepare("CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,link TEXT NOT NULL UNIQUE,author TEXT DEFAULT '',updated_at INTEGER NOT NULL)"),
    e.DB.prepare("CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)"),
    e.DB.prepare("CREATE TABLE IF NOT EXISTS users(user_id INTEGER PRIMARY KEY,username TEXT DEFAULT '',full_name TEXT DEFAULT '',started_at INTEGER NOT NULL)")
  ]);
}
async function sync(e:Env){
  const r=await fetch(e.BOOKS_URL||CATALOG); if(!r.ok) throw new Error("Catalog HTTP "+r.status);
  const data:any=await r.json(), rows:any[]=[];
  const walk=(n:any,a="")=>{
    if(Array.isArray(n)){n.forEach(x=>walk(x,a));return;}
    if(!n||typeof n!=="object")return;
    const author=String(n.author||n.name||a||"");
    if(Array.isArray(n.books))n.books.forEach((x:any)=>walk(x,author));
    if(Array.isArray(n.authors))n.authors.forEach((x:any)=>walk(x,author));
    if(n.title&&n.link)rows.push({title:String(n.title),link:String(n.link),author});
  };
  walk(data);
  if(!rows.length)throw new Error("No books found");
  await e.DB.batch(rows.map(b=>e.DB.prepare(
    "INSERT INTO books(title,link,author,updated_at) VALUES(?,?,?,?) ON CONFLICT(link) DO UPDATE SET title=excluded.title,author=excluded.author,updated_at=excluded.updated_at"
  ).bind(b.title,b.link,b.author,Date.now())));
  return rows.length;
}
async function search(e:Env,q:string){
  const r=await e.DB.prepare("SELECT title,link,author FROM books").all(), n=norm(q);
  return (r.results||[]).filter((b:any)=>norm(b.title).includes(n)||norm(b.author).includes(n)).slice(0,20);
}
async function addBook(e:Env,author:string,title:string,link:string){
  if(!e.GITHUB_TOKEN)throw new Error("GITHUB_TOKEN မထည့်ရသေးပါ");
  const url="https://api.github.com/repos/"+(e.GITHUB_REPO||REPO)+"/contents/data.json";
  const h:any={"Authorization":"Bearer "+e.GITHUB_TOKEN,"Accept":"application/vnd.github+json","User-Agent":"Bookfilderwow-Cloudflare"};
  const cr=await fetch(url,{headers:h}); if(!cr.ok)throw new Error("GitHub data.json HTTP "+cr.status);
  const meta:any=await cr.json(), data:any=JSON.parse(atob(meta.content.replace(/\s/g,"")));
  let added=false;
  const walk=(n:any)=>{
    if(!n||added)return;
    if(Array.isArray(n)){n.some(walk);return;}
    if(Array.isArray(n.books)&&(!author||String(n.author||n.name||"")===author)){n.books.push({title,link});added=true;return;}
    if(Array.isArray(n.authors))n.authors.some(walk);
  };
  walk(data);
  if(!added){
    if(Array.isArray(data))data.push({title,link,author});
    else{data.books=data.books||[];data.books.push({title,link,author});}
  }
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2)+"\n")));
  const wr=await fetch(url,{method:"PUT",headers:{...h,"content-type":"application/json"},
    body:JSON.stringify({message:"Add: "+title,content:encoded,sha:meta.sha})});
  if(!wr.ok)throw new Error("GitHub save HTTP "+wr.status);
  await e.DB.prepare("INSERT OR IGNORE INTO books(title,link,author,updated_at) VALUES(?,?,?,?)").bind(title,link,author,Date.now()).run();
}
async function command(u:any,e:Env){
  const m=u.message,t=String(m.text||""),first=(t.trim().split(/\s+/)[0]||""),cmd=first.split("@")[0].toLowerCase(),arg=t.slice(first.length).trim(),id=m.chat.id;
  if(m.from)await e.DB.prepare(
    "INSERT INTO users(user_id,username,full_name,started_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,full_name=excluded.full_name"
  ).bind(m.from.id,m.from.username||"",[m.from.first_name,m.from.last_name||""].join(" ").trim(),Date.now()).run();

  if(cmd==="/start")return say(e,id,"🤖 <b>Bookfilderwow_bot</b> မှ ကြိုဆိုပါတယ်။\n\n/search စာအုပ်နာမည် — စာအုပ်ရှာရန်\n/authors — စာရေးသူများ\n/stats — စာရင်းဇယား\n/help — အကူအညီ");
  if(cmd==="/help")return say(e,id,"<b>📚 Book Bot</b>\n\n/search စာအုပ်နာမည်\n/find စာအုပ်နာမည်\n/authors\n/stats\n/add စာရေးသူ - စာအုပ်နာမည် - link (Admin)\n/sync (Admin)");
  if(cmd==="/search"||cmd==="/find"){
    if(!arg)return say(e,id,"🔎 ရှာလိုတဲ့ စာအုပ်/စာရေးသူနာမည် ထည့်ပါ။");
    let r=await search(e,arg);
    if(!r.length){try{await sync(e);r=await search(e,arg);}catch{}}
    if(!r.length)return say(e,id,"❌ မတွေ့ပါ။");
    return say(e,id,r.map((b:any,i:number)=>(i+1)+". <b>"+esc(b.title)+"</b>"+(b.author?" — "+esc(b.author):"")+"\n<a href=\""+esc(b.link)+"\">📖 ဖတ်ရန် / ရယူရန်</a>").join("\n\n"));
  }
  if(cmd==="/authors"){
    const r=await e.DB.prepare("SELECT author,COUNT(*) count FROM books WHERE author<>'' GROUP BY author ORDER BY author").all();
    return say(e,id,(r.results||[]).map((x:any)=>"• "+esc(x.author)+" — "+x.count).join("\n")||"စာရေးသူ မရှိပါ။");
  }
  if(cmd==="/stats"){
    const b=await e.DB.prepare("SELECT COUNT(*) n FROM books").first<any>("n"),u=await e.DB.prepare("SELECT COUNT(*) n FROM users").first<any>("n");
    return say(e,id,"📊 Books: <b>"+(b||0)+"</b>\n👥 Users: <b>"+(u||0)+"</b>");
  }
  if(cmd==="/sync"){
    if(!isAdmin(u,e))return say(e,id,"⛔ Admin only");
    try{return say(e,id,"✅ Catalog sync ပြီးပါပြီ — "+await sync(e)+" books");}
    catch(x:any){return say(e,id,"❌ "+esc(x.message));}
  }
  if(cmd==="/add"){
    if(!isAdmin(u,e))return say(e,id,"⛔ Admin only");
    const p=arg.split(" - ").map(x=>x.trim());
    if(p.length<3)return say(e,id,"အသုံးပြုပုံ: /add စာရေးသူ - စာအုပ်နာမည် - link");
    try{await addBook(e,p[0],p[1],p[2]);return say(e,id,"✅ စာအုပ်ထည့်ပြီးပါပြီ။");}
    catch(x:any){return say(e,id,"❌ "+esc(x.message));}
  }
  return say(e,id,"❓ Command မသိပါ။ /help");
}
export default {
  async fetch(req:Request,e:Env,ctx:ExecutionContext){
    try{
      await init(e);
      const u=new URL(req.url);
      if(u.pathname==="/health")return new Response("OK");
      if(req.method!=="POST")return new Response("Bookfilderwow Bot");
      if(e.TELEGRAM_SECRET_TOKEN&&req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==e.TELEGRAM_SECRET_TOKEN)return new Response("Unauthorized",{status:401});
      const update:any=await req.json();
      if(update.message?.text)ctx.waitUntil(command(update,e));
      return new Response("OK");
    }catch{return new Response("OK");}
  }
};