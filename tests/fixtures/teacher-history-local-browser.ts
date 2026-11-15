import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type TeacherOptions = { locale: "zh-CN" | "en"; route?: "messages" | "account" | "helper"; holdUser?: boolean; holdMetadata?: boolean; actualConsent?: boolean; role?: string; consentReady?: boolean; [key: string]: unknown };
const root = process.cwd();
let cssPromise: Promise<string> | undefined;
const runtime = String.raw`
import { useEffect, useState } from "react";
export const state = { options: window.__teacherOptions, calls: [], authCalls: [], queries: [], unexpected: [], pending: [], created: [], revoked: [], clicks: [], removed: [], completed: [], abortEvents: [], consentReady: window.__teacherOptions.consentReady === true };
const A="00000000-0000-4000-8000-000000000011", B="00000000-0000-4000-8000-000000000012";
let actor=A, sessionError=false, seq=0, actorEpoch=0, consentEpoch=0;
const listeners=new Set(), consentListeners=new Set();
const user=()=>actor ? { id:actor, email:"synthetic@fixture.invalid" } : null;
const session=()=>actor ? { user:user(), access_token:"synthetic:"+actor } : null;
function forbidden(name) { state.unexpected.push(name); throw new Error("Forbidden: "+name); }
function hold(kind,value) { return new Promise((resolve)=>state.pending.push({ id:++seq, kind, release:()=>resolve(value) })); }
export const client={auth:{
 getSession:async()=>{ state.authCalls.push({kind:"session",actor}); const value={data:{session:session()},error:sessionError?new Error("Synthetic session unavailable"):null}; return state.options.holdSession?hold("session",value):value; },
 getUser:async()=>{ state.authCalls.push({kind:"user",actor}); const value={data:{user:state.options.userFailure?null:user()},error:null}; return state.options.holdUser?hold("user",value):value; },
 onAuthStateChange:(fn)=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 signInWithOtp:()=>forbidden("OTP"),verifyOtp:()=>forbidden("OTP"),exchangeCodeForSession:()=>forbidden("exchangeCode"),
}, from:(table)=>{
 if(!["sweet_records","wechat_identities"].includes(table)) return forbidden("SDK table "+table);
 const q={table,ops:[]}, chain={}; state.queries.push(q);
 for(const method of ["select","eq","order","limit"]) chain[method]=(...args)=>{q.ops.push([method,...args]);return chain;};
 chain.then=(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);return chain;
}};
export function useSyntheticConsent(){ const [,setRevision]=useState(0); useEffect(()=>{const fn=()=>setRevision(v=>v+1);consentListeners.add(fn);return()=>consentListeners.delete(fn);},[]);
 const id=actor, actorRevision=actorEpoch, consentRevision=consentEpoch;
 const current=()=>actor===id&&actorRevision===actorEpoch&&consentRevision===consentEpoch;
 return {phase:state.options.consentError?"error":"other",userId:id,summary:null,busy:false,errorKind:null,refresh:async()=>{},assent:()=>forbidden("assent"),completeProfile:()=>forbidden("saveProfile"),trackRequest:()=>current,isSameActor:(value)=>actor===value,canProceed:true,studentReady:state.consentReady};
}
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
function metadata(id){return { profile:{id,display_name:id===A?"Synthetic Teacher A":"Synthetic Teacher B",email:"synthetic@fixture.invalid",role:"学校支持人员",school_id:"00000000-0000-4000-8000-000000000099"},displayRole:state.options.role||"支持老师",hasSchool:true,adminAccess:null,schoolMemberships:[],studentAgeBand:null,linkedChildren:[],assignedStudents:[{id:"00000000-0000-4000-8000-000000000021",display_name:"Assigned fact",school_id:"00000000-0000-4000-8000-000000000099"}],assignedTeachers:[],linkedGuardians:[]};}
function message(id){return {id:"00000000-0000-4000-8000-000000000111",school_id:null,sender_user_id:null,recipient_user_id:id,recipient_type:"teacher",anonymous_to_recipient:true,body:(id===A?"A PRIVATE BODY":"B PRIVATE BODY")+(state.options.marker||""),moderation_status:"sent",duty_status:"not_applicable",alert_delivery_status:"not_requested",read_at:null,created_at:"2026-11-01T00:00:00Z",sender_name:"Anonymous student",recipient_name:"Teacher",canRevealSender:false};}
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),"https://teacher-mock.invalid"),method=init.method||"GET";
 if(url.origin!=="https://teacher-mock.invalid") return forbidden("external fetch "+url.origin);
 const id=(init.headers?.authorization||"").replace("Bearer synthetic:","");
 state.calls.push({path:url.pathname,method,actor:id,cache:init.cache||null});
 if(!id||id!==actor) return response({error:"Synthetic sign-in required"},401);
 if(method==="POST"&&url.pathname==="/api/messages") {
  const signal=init.signal;
  signal?.addEventListener("abort",()=>state.abortEvents.push(state.options.postMode||"normal"),{once:true});
  const result=response(state.options.postResult||{},state.options.postFailure||200);
  if(state.options.postMode==="request_stall") return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException("Synthetic request aborted","AbortError"));
    if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
  });
  if(state.options.postMode==="late_success") return hold("post",result);
  if(state.options.postMode==="body_stall") {
    result.json=()=>new Promise((resolve,reject)=>{
      const abort=()=>reject(new DOMException("Synthetic body aborted","AbortError"));
      if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
    });
    return result;
  }
  if(state.options.readFailureAfterPost) state.options.readFailure=state.options.readFailureAfterPost;
  return result;
 }
 if(method!=="GET") return forbidden(method+" "+url.pathname);
 if(url.pathname==="/api/account/status") {const r=response(metadata(id));return state.options.holdMetadata?hold("metadata",r):r;}
 if(url.pathname==="/api/account/consent") return state.options.consentError?response({error:"Synthetic consent unavailable"},503):response({role:"other",policyVersion:"2026-08-28",consent:null,children:[]});
 if(url.pathname==="/api/messages") {const r=state.options.readFailure?response({error:"Synthetic message unavailable"},state.options.readFailure):response(state.options.malformed?{}:{messages:state.options.empty?[]:[message(id)],pilotDutyAvailable:false,pilotDutyEmailConfigured:false});return state.options.holdRead?hold("read",r):r;}
 if(url.pathname==="/api/account/data") {
  if(state.options.exportFailure)return response({error:"Synthetic export refused"},503);
  const r=new Response(JSON.stringify({messages:[message(id)]}),{status:200,headers:{"content-type":"application/json","content-disposition":'attachment; filename="Synthetic-export.json"'}});
  if(state.options.holdBlob){const blob=await r.blob();r.blob=()=>hold("blob",blob);} return state.options.holdExport?hold("export",r):r;
 }
 return forbidden(method+" "+url.pathname);
};
window.XMLHttpRequest=class {constructor(){forbidden("XMLHttpRequest");}};
window.WebSocket=class {constructor(){forbidden("WebSocket");}};
navigator.sendBeacon=()=>forbidden("sendBeacon");
URL.createObjectURL=(blob)=>{const value="blob:synthetic/"+(state.created.length+1);state.created.push(value);if(state.options.retireOnCreate)state.options.current=false;return value;};
URL.revokeObjectURL=(url)=>state.revoked.push(url);
HTMLAnchorElement.prototype.click=function(){state.clicks.push({href:this.href,download:this.download});if(state.options.throwClick)throw new Error("Synthetic click failure");};
const remove=HTMLAnchorElement.prototype.remove;HTMLAnchorElement.prototype.remove=function(){state.removed.push(this.href);remove.call(this);};
window.__teacher={state,
 set:(key,value)=>{state.options[key]=value;},
 actor:(id)=>{if(id!==actor)++actorEpoch;actor=id;listeners.forEach(fn=>fn(id?"SIGNED_IN":"SIGNED_OUT",session()));consentListeners.forEach(fn=>fn());},
 consent:(ready)=>{if(ready!==state.consentReady)++consentEpoch;state.consentReady=ready;consentListeners.forEach(fn=>fn());},
 consentGeneration:()=>{++consentEpoch;consentListeners.forEach(fn=>fn());},
 sessionError:(value)=>{sessionError=value;},
 release:(kind="all",one=false)=>{const selected=state.pending.filter(item=>kind==="all"||item.kind===kind).slice(0,one?1:undefined);state.pending=state.pending.filter(item=>!selected.includes(item));selected.forEach(item=>item.release());},
 visibility:(value)=>{Object.defineProperty(document,"visibilityState",{configurable:true,value});document.dispatchEvent(new Event("visibilitychange"));},
 focus:()=>window.dispatchEvent(new Event("focus")),
};
`;
const virtual: Record<string,string> = {
 "teacher:runtime":runtime,
 "@/lib/supabaseClient":`import {client} from "teacher:runtime";export const getSupabase=()=>client;export const isSupabaseConfigured=()=>true;export const signOutSupabaseSession=async()=>{throw new Error("Synthetic signout not authorized");};`,
 "@/lib/useInlineStudentConsent":`export {useSyntheticConsent as useInlineStudentConsent} from "teacher:runtime";`,
 "@/lib/clientMonitoring":`export const reportClientOperationFailure=()=>{};`,
 "@/lib/emailOtp":`export const emailOtpLength=8;export const isOtpRateLimitError=()=>false;export const otpRequestErrorMessage=()=>"Synthetic OTP error";export const otpVerificationErrorMessage=otpRequestErrorMessage;`,
 "@/components/ProfessionalVerificationCard":`export const ProfessionalVerificationCard=()=>null;`,
 "@/components/AgePathWorkspace":`export const AgePathWorkspace=()=>null;`,
 "@/components/AiTransparencyNotice":`export const AiGeneratedLabel=()=>null;`,
 "next/router":`export const useRouter=()=>({locale:window.__teacherOptions.locale,isReady:true,query:{},asPath:"/account",replace:async()=>false});`,
 "next/link":`import {jsx} from "react/jsx-runtime";export default function Link({href,children,...props}){return jsx("a",{...props,href,children});}`,
 "next/image":`import {jsx} from "react/jsx-runtime";export default function Image({priority,loading,src,alt,...props}){return jsx("div",{...props,role:"img","aria-label":alt,"data-source":src});}`,
};
async function bundle(route:string,actualConsent=false){
 const modules:Record<string,{source:string;dependencies:Record<string,string>}>= {};
 const allowed=new Set(["views/messages/page.tsx","views/account/page.tsx","components/PageHero.tsx","components/SectionHeader.tsx","components/InlineStudentConsent.tsx","components/VoiceInputButton.tsx","components/IllustrationPanel.tsx","lib/useSessionActor.ts","lib/useInlineStudentConsent.ts","lib/studentConsent.ts","lib/sweetPersistenceProtocol.ts","lib/cloudRecords.ts","lib/sweetRecordDays.ts","lib/guardianAccessPolicy.ts","lib/navigation.ts","lib/sessionSignOut.ts","lib/peerSpaceClient.ts","lib/checkInHistoryCopy.ts","lib/i18n/client.tsx","lib/i18n/config.ts","lib/i18n/dictionaries.ts","locales/zh-CN.json","locales/en.json"]);
 async function add(id:string,file?:string):Promise<string>{
  if(modules[id])return id;
  const useActualConsent=actualConsent&&id==="@/lib/useInlineStudentConsent";
  const source=(!useActualConsent?virtual[id]:undefined)??await readFile(file!,"utf8");
  const compiled=file?.endsWith(".json")?`module.exports=${source};`:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const entry=modules[id]={source:compiled,dependencies:{} as Record<string,string>};
  for(const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)){
   const name=match[1];
   if(virtual[name]&&!(actualConsent&&name==="@/lib/useInlineStudentConsent"))entry.dependencies[name]=await add(name);
   else if(name.startsWith("@/")){const base=name.slice(2),local=[base,base+".ts",base+".tsx"].find(p=>allowed.has(p));if(!local)throw new Error("Unmocked application module: "+name);entry.dependencies[name]=await add(name,path.join(root,local));}
   else if(/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name)||(file?.includes("node_modules")&&name.startsWith("."))){const resolved=createRequire(file||path.join(root,"package.json")).resolve(name);if(!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved))throw new Error("Disallowed vendor "+name);entry.dependencies[name]=await add(resolved,resolved);}
   else throw new Error("Unmocked import: "+name);
  }return id;
 }
 await add("teacher:runtime");
 if(route!=="helper")await add("teacher:route",path.join(root,route==="account"?"views/account/page.tsx":"views/messages/page.tsx"));
 await add("@/lib/cloudRecords",path.join(root,"lib/cloudRecords.ts"));await add("@/lib/i18n/client",path.join(root,"lib/i18n/client.tsx"));
 for(const name of ["react-dom/client","react/jsx-runtime"])await add(name,createRequire(path.join(root,"package.json")).resolve(name));
 return `(function(){const process={env:{NODE_ENV:"production"}};const factories={${Object.entries(modules).map(([id,e])=>`${JSON.stringify(id)}:[function(module,exports,require){\n${e.source}\n},${JSON.stringify(e.dependencies)}]`).join(",\n")}};const cache={};function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};const [factory,deps]=factories[id];factory(module,module.exports,(name)=>{if(!deps[name])throw new Error("Unmocked require "+name);return load(deps[name]);});return module.exports;}
 load("teacher:runtime");const ui=window.__teacher;ui.startDownload=()=>{load("@/lib/cloudRecords").downloadAccountDataExport("00000000-0000-4000-8000-000000000011",()=>ui.state.options.current!==false).then(()=>ui.state.completed.push("ok"),e=>ui.state.completed.push("error:"+e.message));};
 ${route!=="helper"?`const jsx=load("react/jsx-runtime").jsx;const root=load("react-dom/client").createRoot(document.getElementById("root"));ui.unmount=()=>root.unmount();root.render(jsx(load("@/lib/i18n/client").I18nProvider,{children:jsx("main",{children:jsx(load("teacher:route").default,{})})}));`:""}})();`;
}
async function css(){
 const config=ts.transpileModule(await readFile(path.join(root,"tailwind.config.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const configModule={exports:{} as {default?:Record<string,unknown>}};new Function("module","exports",config)(configModule,configModule.exports);
 const files=["views/messages/page.tsx","views/account/page.tsx","components/PageHero.tsx","components/InlineStudentConsent.tsx","components/SectionHeader.tsx"];
 const raw=(await Promise.all(files.map(f=>readFile(path.join(root,f),"utf8")))).join("\n");
 return(await postcss([tailwindcss({...configModule.exports.default,content:[{raw,extension:"tsx"}]}),autoprefixer]).process(await readFile(path.join(root,"views/globals.css"),"utf8"),{from:undefined})).css;
}
export async function openTeacher(page:Page,options:TeacherOptions){
 const network:string[]=[],errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const url=`https://teacher-mock.invalid${options.locale==="en"?"/en":""}/${options.route||"messages"}`;
 await page.route("**/*",route=>{if(route.request().url()===url&&route.request().isNavigationRequest())return route.fulfill({status:200,contentType:"text/html",body:`<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"></head><body><div id="root"></div></body></html>`});network.push(route.request().url());return route.abort("blockedbyclient");});
 await page.goto(url);await page.evaluate(options=>Object.assign(window,{__teacherOptions:options}),options);
 cssPromise??=css();await page.addStyleTag({content:await cssPromise});await page.addScriptTag({content:await bundle(options.route||"messages",options.actualConsent)});
 if(options.route!=="helper")await expect(page.locator("#root main")).toBeVisible();return{network,errors};
}
export function controlTeacher(page:Page,action:string,...args:unknown[]){return page.evaluate(({action,args})=>(window as unknown as {__teacher:Record<string,(...values:unknown[])=>unknown>}).__teacher[action](...args),{action,args});}
export function teacherState(page:Page){return page.evaluate(()=>{const s=(window as unknown as {__teacher:{state:{calls:Array<{path:string;method:string;actor:string;cache:string|null}>;authCalls:Array<{kind:string;actor:string}>;queries:Array<{table:string;ops:unknown[]}>;unexpected:string[];pending:Array<{id:number;kind:string}>;created:string[];revoked:string[];clicks:Array<{href:string;download:string}>;removed:string[];completed:string[];abortEvents:string[]}}}).__teacher.state;return{...s,pending:s.pending.map(p=>({id:p.id,kind:p.kind}))};});}
