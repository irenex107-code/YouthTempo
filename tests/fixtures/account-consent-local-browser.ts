import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type TeacherOptions = { locale: "zh-CN" | "en"; route?: "messages" | "account" | "feedback" | "helper"; holdUser?: boolean; holdMetadata?: boolean; actualConsent?: boolean; role?: string; consentReady?: boolean; [key: string]: unknown };
const root = process.cwd();
let cssPromise: Promise<string> | undefined;
const runtime = String.raw`
export const state={options:window.__teacherOptions,calls:[],authCalls:[],queries:[],unexpected:[],pending:[],created:[],revoked:[],clicks:[],removed:[],completed:[],abortEvents:[],operations:[]};
const A="00000000-0000-4000-8000-000000000011",B="00000000-0000-4000-8000-000000000012",R="00000000-0000-4000-8000-000000000221";
let actor=A,sessionError=false,sequence=0;
const listeners=new Set(),profiles=new Map(),consents=new Map();
const raw="PUBLIC SYNTHETIC misleading 403 timeout diagnostic";
const user=()=>actor?{id:actor,email:"synthetic@fixture.invalid"}:null;
const session=()=>actor?{user:user(),access_token:"synthetic:"+actor}:null;
function forbidden(name){state.unexpected.push(name);throw new Error("Forbidden "+name);}
function profile(id){if(!profiles.has(id))profiles.set(id,{id,display_name:id===A?"Synthetic A":"Synthetic B",email:"synthetic@fixture.invalid",role:state.options.role||"学生",school_id:null});return profiles.get(id);}
function consent(id){if(!consents.has(id)){const s=state.options.consentState||"not_started";consents.set(id,{studentUserId:id,studentName:"Synthetic student",ageBand:s==="not_started"?null:"14_17",consentBasis:s==="not_started"?null:"student_self_pilot",policyVersion:"2026-08-28",status:s,studentAssentedAt:s==="not_started"?null:"2026-11-01T00:00:00Z",guardianUserId:null,guardianConsentedAt:null,withdrawnAt:null,hasLinkedGuardian:false});}return consents.get(id);}
const copy=x=>JSON.parse(JSON.stringify(x));
function consentReply(id){return state.options.role==="家长"?{role:"guardian",policyVersion:"2026-08-28",consent:null,children:[{...consent(id),studentUserId:"00000000-0000-4000-8000-000000000021",status:"pending_guardian",consentBasis:"student_guardian"}]}:{role:"student",policyVersion:"2026-08-28",consent:copy(consent(id)),children:[]};}
function metadata(id){return{profile:copy(profile(id)),displayRole:profile(id).role==="学校支持人员"?"支持老师":profile(id).role,hasSchool:!!profile(id).school_id,adminAccess:null,schoolMemberships:[],studentAgeBand:consent(id).ageBand,linkedChildren:[],assignedStudents:[],assignedTeachers:[],linkedGuardians:[]};}
function hold(kind,value){return new Promise((resolve,reject)=>state.pending.push({id:++sequence,kind,release:()=>resolve(value),reject:()=>reject(new TypeError(raw))}));}
function finish(kind,value){state.completed.push(kind);return value;}
const mode=kind=>state.options.modes?.[kind]||"unknown";
function record(id=actor){return{id:state.options.recordId||R,user_id:id,school_id:null,created_at:"2026-11-01T08:00:00Z",records:[],summary:null,small_step:null,recommended_next_tool:null};}
export const client={auth:{
 getSession:async()=>{state.authCalls.push({kind:"session",actor});const r={data:{session:session()},error:sessionError?new Error(raw):null};return state.options.holdSession?hold("session",r):r;},
 getUser:async()=>{state.authCalls.push({kind:"user",actor});return{data:{user:state.options.userFailure?null:user()},error:null};},
 onAuthStateChange:fn=>{listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 initialize:async()=>({error:null}),_signOut:async()=>forbidden("SDK signout outside this batch"),signOut:async()=>forbidden("SDK signout outside this batch"),
 signInWithOtp:()=>forbidden("OTP"),verifyOtp:()=>forbidden("OTP"),exchangeCodeForSession:()=>forbidden("exchangeCode")
},from:table=>{
 if(!["profiles","sweet_records","wechat_identities"].includes(table))return forbidden("SDK "+table);
 const q={table,ops:[]};state.queries.push(q);const chain={};let promise;
 for(const method of ["select","eq","order","limit","update","insert"])chain[method]=(...args)=>{q.ops.push([method,...args]);return chain;};
 async function execute(){
  const id=(q.ops.find(o=>o[0]==="eq"&&o[1]==="user_id")||q.ops.find(o=>o[0]==="eq"&&o[1]==="id"))?.[2]||actor;
  const mutation=q.ops.find(o=>["update","insert"].includes(o[0]));
  let result;
  if(table==="profiles"&&mutation){
   const m=mode("profile");state.operations.push({kind:"profile",actor:id,method:mutation[0],value:copy(mutation[1])});
   if(m==="pre_rejected")result={data:null,error:{message:raw,code:"42501"},status:403};
   else if(["partial_insert","zero_update_hold"].includes(m)&&mutation[0]==="update")result={data:null,error:null,status:200};
   else if(["success","late_success","hold_success"].includes(m)){Object.assign(profile(id),mutation[1]);result={data:copy(profile(id)),error:null,status:200};}
   else if(m==="malformed")result={data:{id},error:null,status:200};
   else if(m==="throw")throw new TypeError(raw);
   else result={data:null,error:{message:raw,code:"NETWORK"},status:0};
   if(m==="late_success"||m==="hold_success"||m==="zero_update_hold")result=await hold("profile-write",result);
   return finish("profile",result);
  }
  if(table==="profiles")result=state.options.profileReadFail?{data:null,error:new Error(raw),status:503}:{data:copy(profile(id)),error:null,status:200};
  else if(table==="sweet_records"){
   const row=record(id),lookup=q.ops.find(o=>o[0]==="eq"&&o[1]==="id");if(lookup)row.id=lookup[2];
   result=state.options.recordsReadFail||(state.options.deleted&&state.options.recordListFailureAfterDelete)?{data:null,error:new Error(raw),status:503}:{data:state.options.recordSeed&&!state.options.deleted?[row]:[],error:null,status:200};
  }
  else result={data:[],error:null,status:200};
  if(state.options.holdRead===table)result=await hold(table+"-read",result);
  return result;
 }
 const once=()=>promise??=execute();
 chain.maybeSingle=async()=>{const r=await once();return{...r,data:Array.isArray(r.data)?r.data[0]||null:r.data};};chain.single=chain.maybeSingle;
 chain.then=(resolve,reject)=>once().then(resolve,reject);return chain;
}};
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
async function writeResponse(kind,body,id){
 const m=mode(kind);state.operations.push({kind,actor:id,method:kind==="withdraw"?"DELETE":"POST",value:copy(body)});
 if(m==="request_error")throw new TypeError(raw);
 if(m==="denied")return finish(kind,response({error:raw},403));
 if(m==="invalid")return finish(kind,response({error:raw},400));
 if(m==="not_found")return finish(kind,response({error:raw},404));
 if(kind==="guardian")return finish(kind,response({error:raw},403));
 if(["success","late_success","partial"].includes(m)){
  const c=consent(id);if(kind==="assent")Object.assign(c,{ageBand:body.ageBand,consentBasis:body.ageBand==="18_plus"?"adult_self":body.ageBand==="under_14"?"not_applicable":"student_self_pilot",status:body.ageBand==="under_14"?"ineligible":"active",studentAssentedAt:body.ageBand==="under_14"?null:"2026-11-12T00:00:00Z",withdrawnAt:null});
  if(kind==="withdraw")Object.assign(c,{status:"withdrawn",withdrawnAt:"2026-11-12T01:00:00Z"});
  if(kind==="sweet")state.options.deleted=true;
 }
 let r=kind==="sweet"?response({status:"accepted",operationDay:"2026-11-12",targetDay:body.targetDay,headToken:"00000000-0000-4000-8000-000000000222",record:null}):response(consentReply(id));
 if(m==="unknown"||m==="partial")r=kind==="sweet"?response({status:"protocol_unavailable",error:raw},503):response({error:raw},500);
 if(m==="sweet_denied")r=response({status:"denied",writeOutcome:"not_committed",error:raw},403);
 if(m==="malformed")r=response({});
 if(m==="active_null"){
  const invalid=consentReply(id);Object.assign(invalid.consent,{status:"active",ageBand:null,consentBasis:null,studentAssentedAt:null});r=response(invalid);
 }
 if(m==="non_json")r=new Response(raw,{status:503,headers:{"content-type":"text/plain"}});
 if(m==="body_error")r.json=async()=>{throw new TypeError(raw);};
 if(m==="late_success")r=await hold(kind+"-write",r);
 return finish(kind,r);
}
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),"https://teacher-mock.invalid"),method=init.method||"GET";
 if(url.origin!=="https://teacher-mock.invalid")return forbidden("external "+url.origin);
 const id=(init.headers?.authorization||"").replace("Bearer synthetic:","");
 const body=init.body?JSON.parse(init.body):null;state.calls.push({path:url.pathname,method,actor:id,body});
 if(url.pathname==="/api/monitoring/client-error"&&method==="POST")return new Response(null,{status:204});
 if(state.options.deletionReceipt&&url.pathname==="/api/account/deletion-status"&&method==="POST"){
  const r=response({state:state.options.deletionState||"unknown"});
  return state.options.holdDeletionStatus?hold("deletion-status",r):r;
 }
 if(!id||id!==actor)return response({error:raw},401);
 if(state.options.deletionReceipt&&url.pathname==="/api/account/data"&&method==="DELETE"){
  state.operations.push({kind:"accountDelete",actor:id,method,value:copy(body)});
  // Public synthetic refusal only: no account, Auth or database is changed.
  return response({error:raw,deletionState:"not_deleted"},403);
 }
 if(url.pathname==="/api/account/consent"&&method!=="GET")return writeResponse(method==="DELETE"?"withdraw":body.action==="guardian_consent"?"guardian":"assent",body,id);
 if(url.pathname==="/api/sweet-records"){
  if(method==="POST")return writeResponse("sweet",body,id);
  const r=response({status:"ready",operationDay:state.options.operationDay||"2026-11-12",targetDay:url.searchParams.get("targetDay")||state.options.operationDay||"2026-11-12",headToken:state.options.headToken||"00000000-0000-4000-8000-000000000222",record:null});
  return state.options.scopeFail?response({status:"protocol_unavailable"},503):r;
 }
 if(method!=="GET")return forbidden(method+" "+url.pathname);
 let r;
 if(url.pathname==="/api/account/status")r=state.options.statusReadFail?response({error:raw},503):response(metadata(id));
 else if(url.pathname==="/api/account/consent")r=state.options.consentReadFail?response({error:raw},503):response(consentReply(id));
 else if(url.pathname==="/api/support/staff")r=response({application:null});
 else if(url.pathname==="/api/peer-space/access")r=response({available:false});
 else return forbidden(method+" "+url.pathname);
 if(state.options.holdRead===url.pathname)r=await hold(url.pathname+"-read",r);
 return r;
};
window.XMLHttpRequest=class{constructor(){forbidden("XMLHttpRequest");}};
window.WebSocket=class{constructor(){forbidden("WebSocket");}};
navigator.sendBeacon=()=>forbidden("sendBeacon");
window.__teacher={state,
 set:(key,value)=>{state.options[key]=value;},
 mode:(kind,value)=>{state.options.modes??={};state.options.modes[kind]=value;},
 actor:id=>{actor=id;listeners.forEach(fn=>fn(id?"SIGNED_IN":"SIGNED_OUT",session()));},
 consent:patch=>{Object.assign(consent(actor),patch);window.dispatchEvent(new Event("youthtempo:consent-updated"));},
 role:value=>{profile(actor).role=value;},
 sessionError:value=>{sessionError=value;},
 release:(kind,reject=false)=>{const items=state.pending.filter(p=>p.kind===kind);state.pending=state.pending.filter(p=>!items.includes(p));items.forEach(p=>reject?p.reject():p.release());},
 unmount:()=>{},
};
`;
const virtual: Record<string,string> = {
 "teacher:runtime":runtime,
 "@supabase/supabase-js":`import {client,state} from "teacher:runtime";export const createClient=(url)=>{state.sdkOrigin=url;return client;};`,
 "next/router":`export const useRouter=()=>({locale:window.__teacherOptions.locale,isReady:true,query:{},asPath:"/account",replace:async()=>false});`,
 "next/link":`import {jsx} from "react/jsx-runtime";export default function Link({href,children,...props}){return jsx("a",{...props,href,children});}`,
 "next/image":`import {jsx} from "react/jsx-runtime";export default function Image({priority,loading,src,alt,...props}){return jsx("div",{...props,role:"img","aria-label":alt,"data-source":src});}`,
};
async function bundle(route:string){
 const actualFiles:string[]=[];
 const extraApplicationFiles=["lib/supabaseClient.ts","lib/emailOtp.ts","lib/clientMonitoring.ts","lib/professionalVerification.ts","lib/aiNotice.ts","components/ProfessionalVerificationCard.tsx","components/AgePathWorkspace.tsx","components/AiTransparencyNotice.tsx"];
 const modules:Record<string,{source:string;dependencies:Record<string,string>}>= {};
 const allowed=new Set(["views/messages/page.tsx","views/account/page.tsx","components/PageHero.tsx","components/SectionHeader.tsx","components/InlineStudentConsent.tsx","components/VoiceInputButton.tsx","components/IllustrationPanel.tsx","lib/useSessionActor.ts","lib/useInlineStudentConsent.ts","lib/studentConsent.ts","lib/sweetPersistenceProtocol.ts","lib/cloudRecords.ts","lib/sweetRecordDays.ts","lib/guardianAccessPolicy.ts","lib/navigation.ts","lib/sessionSignOut.ts","lib/peerSpaceClient.ts","lib/checkInHistoryCopy.ts","lib/referralDisplayContext.ts","lib/pilotFeedback.ts","lib/i18n/client.tsx","lib/i18n/config.ts","lib/i18n/dictionaries.ts","locales/zh-CN.json","locales/en.json"]);
 async function add(id:string,file?:string):Promise<string>{
  if(modules[id])return id;
  for(const file of extraApplicationFiles)allowed.add(file);
  if(file)actualFiles.push(path.relative(root,file));
  const useActualConsent=id==="@/lib/useInlineStudentConsent";
  const source=(!useActualConsent?virtual[id]:undefined)??await readFile(file!,"utf8");
  const compiled=file?.endsWith(".json")?`module.exports=${source};`:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const entry=modules[id]={source:compiled,dependencies:{} as Record<string,string>};
  for(const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)){
   const name=match[1];
   if(virtual[name]&&!(name==="@/lib/useInlineStudentConsent"))entry.dependencies[name]=await add(name);
   else if(name.startsWith("@/")){const base=name.slice(2),local=[base,base+".ts",base+".tsx"].find(p=>allowed.has(p));if(!local)throw new Error("Unmocked application module: "+name);entry.dependencies[name]=await add(name,path.join(root,local));}
   else if(/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name)||(file?.includes("node_modules")&&name.startsWith("."))){const resolved=createRequire(file||path.join(root,"package.json")).resolve(name);if(!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved))throw new Error("Disallowed vendor "+name);entry.dependencies[name]=await add(resolved,resolved);}
   else throw new Error("Unmocked import: "+name);
  }return id;
 }
 await add("teacher:runtime");
 await add("@/lib/useSessionActor",path.join(root,"lib/useSessionActor.ts"));
 if(route!=="helper")await add("teacher:route",path.join(root,route==="account"?"views/account/page.tsx":route==="feedback"?"views/feedback/page.tsx":"views/messages/page.tsx"));
 await add("@/lib/cloudRecords",path.join(root,"lib/cloudRecords.ts"));await add("@/lib/i18n/client",path.join(root,"lib/i18n/client.tsx"));
 for(const name of ["react-dom/client","react/jsx-runtime"])await add(name,createRequire(path.join(root,"package.json")).resolve(name));
 return `(function(){const process={env:{NODE_ENV:"production",NEXT_PUBLIC_SUPABASE_URL:"https://offline-fixture.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"public-synthetic-placeholder"}};const factories={${Object.entries(modules).map(([id,e])=>`${JSON.stringify(id)}:[function(module,exports,require){\n${e.source}\n},${JSON.stringify(e.dependencies)}]`).join(",\n")}};const cache={};function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};const [factory,deps]=factories[id];factory(module,module.exports,(name)=>{if(!deps[name])throw new Error("Unmocked require "+name);return load(deps[name]);});return module.exports;}
 load("teacher:runtime");const ui=window.__teacher;ui.state.applicationModules=${JSON.stringify(actualFiles.filter(file=>/^(views|components|lib|locales)\//.test(file)))};ui.cloud=load("@/lib/cloudRecords");ui.startDownload=()=>{load("@/lib/cloudRecords").downloadAccountDataExport("00000000-0000-4000-8000-000000000011",()=>ui.state.options.current!==false).then(()=>ui.state.completed.push("ok"),e=>ui.state.completed.push("error:"+e.message));};
 ${route!=="helper"?`const jsx=load("react/jsx-runtime").jsx;const root=load("react-dom/client").createRoot(document.getElementById("root"));ui.unmount=()=>root.unmount();root.render(jsx(load("@/lib/i18n/client").I18nProvider,{children:jsx("main",{children:jsx(load("teacher:route").default,{})})}));`:`const jsx=load("react/jsx-runtime").jsx;const root=load("react-dom/client").createRoot(document.getElementById("root"));
 function ActorProbe(){const actor=load("@/lib/useSessionActor").useSessionActor();ui.actorProbe=actor;return jsx("p",{"data-actor-probe":actor.phase,children:actor.phase});}
 root.render(jsx(ActorProbe,{}));ui.unmount=()=>root.unmount();
 ui.runAccountWrite=async(kind)=>{const a=ui.actorProbe,owner=a.actorId,current=a.trackRequest(),cloud=ui.cloud;
  try{if(kind==="profile")await cloud.saveProfile({id:owner,email:"synthetic@fixture.invalid"},"PUBLIC SYNTHETIC contract",{current});
   if(kind==="sweet")await cloud.deleteCloudSweetRecord("00000000-0000-4000-8000-000000000221",owner,current,{current});
   if(kind==="assent")await cloud.submitStudentAssent("18_plus",owner,{current});
   if(kind==="guardian")await cloud.submitGuardianConsent("00000000-0000-4000-8000-000000000021",owner,{current});
   if(kind==="withdraw")await cloud.withdrawStudentConsent(undefined,owner,{current});
   return{ok:true};}catch(e){return{ok:false,outcome:e.outcome||null,reason:e.reason||null,message:e.message};}};
 `}})();`;
}
async function css(){
 const config=ts.transpileModule(await readFile(path.join(root,"tailwind.config.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const configModule={exports:{} as {default?:Record<string,unknown>}};new Function("module","exports",config)(configModule,configModule.exports);
 const files=["views/messages/page.tsx","views/account/page.tsx","views/feedback/page.tsx","components/PageHero.tsx","components/InlineStudentConsent.tsx","components/SectionHeader.tsx"];
 const raw=(await Promise.all(files.map(f=>readFile(path.join(root,f),"utf8")))).join("\n");
 return(await postcss([tailwindcss({...configModule.exports.default,content:[{raw,extension:"tsx"}]}),autoprefixer]).process(await readFile(path.join(root,"views/globals.css"),"utf8"),{from:undefined})).css;
}
export async function openTeacher(page:Page,options:TeacherOptions){
 const network:string[]=[],errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const url=`https://teacher-mock.invalid${options.locale==="en"?"/en":""}/${options.route||"messages"}`;
 await page.route("**/*",route=>{if(route.request().url()===url&&route.request().isNavigationRequest())return route.fulfill({status:200,contentType:"text/html",body:`<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"></head><body><div id="root"></div></body></html>`});network.push(route.request().url());return route.abort("blockedbyclient");});
 await page.goto(url);await page.evaluate(options=>Object.assign(window,{__teacherOptions:options}),options);
 if(options.deletionReceipt)await page.evaluate(()=>sessionStorage.setItem("youthtempo:account-deletion-receipts:v1",JSON.stringify([{
  subjectUserId:"00000000-0000-4000-8000-000000000011",operationId:"00000000-0000-4000-8000-000000000444",
  secret:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",expiresAt:Date.now()+3_600_000,
 }])));
 cssPromise??=css();await page.addStyleTag({content:await cssPromise});await page.addScriptTag({content:await bundle(options.route||"messages")});
 if(options.route!=="helper")await expect(page.locator("#root main")).toBeVisible();return{network,errors};
}
export function controlTeacher(page:Page,action:string,...args:unknown[]){return page.evaluate(({action,args})=>(window as unknown as {__teacher:Record<string,(...values:unknown[])=>unknown>}).__teacher[action](...args),{action,args});}
export function teacherState(page:Page){return page.evaluate(()=>{const s=(window as unknown as {__teacher:{state:{operations:Array<{kind:string;actor:string;method:string;value:unknown}>;calls:Array<{path:string;method:string;actor:string;cache:string|null}>;authCalls:Array<{kind:string;actor:string}>;queries:Array<{table:string;ops:unknown[]}>;unexpected:string[];pending:Array<{id:number;kind:string}>;created:string[];revoked:string[];clicks:Array<{href:string;download:string}>;removed:string[];completed:string[];abortEvents:string[]}}}).__teacher.state;return{...s,pending:s.pending.map(p=>({id:p.id,kind:p.kind}))};});}
