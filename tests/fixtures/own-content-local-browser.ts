import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type OwnOptions = { locale: "zh-CN" | "en"; consentError?: boolean; noName?: boolean; role?: string };
const root=process.cwd();
let cssPromise:Promise<string>|undefined;
// In-memory synthetic Auth/database transport only. This module never imports the real SDK/config.
const runtime=String.raw`
export const state={options:window.__ownOptions,calls:[],authCalls:[],queries:[],unexpected:[],pending:[],created:[],revoked:[],downloads:[]};
const A="00000000-0000-4000-8000-000000000011",B="00000000-0000-4000-8000-000000000012";
let actor=A,sessionError=false,seq=0;
const listeners=new Set();
const user=()=>actor?{id:actor,email:"synthetic@fixture.invalid"}:null;
const session=()=>actor?{user:user(),access_token:"synthetic:"+actor}:null;
function forbidden(name){state.unexpected.push(name);throw new Error("Forbidden synthetic operation: "+name);}
function hold(kind,value){return new Promise(resolve=>state.pending.push({id:++seq,kind,release:()=>resolve(value)}));}
export function changeActor(id){actor=id;listeners.forEach(fn=>fn(id?"SIGNED_IN":"SIGNED_OUT",session()));}
export async function syntheticSignOut(expected){if(expected&&expected!==actor)throw new Error("session_changed");changeActor("");}
export const client={auth:{
 getSession:async()=>{state.authCalls.push({kind:"session",actor});const result={data:{session:session()},error:sessionError?new Error("Synthetic session unavailable"):null};if(state.options.holdNextSession){state.options.holdNextSession=false;return hold("session",result);}return result;},
 getUser:async()=>{state.authCalls.push({kind:"user",actor});const result={data:{user:state.options.userFailure?null:user()},error:null};return state.options.holdUser?hold("user",result):result;},
 onAuthStateChange:fn=>{listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 signInWithOtp:()=>forbidden("OTP"),verifyOtp:()=>forbidden("OTP"),exchangeCodeForSession:()=>forbidden("exchangeCode"),
},from:table=>{
 if(!["sweet_records","wechat_identities"].includes(table))return forbidden("SDK table "+table);
 const query={table,ops:[]},chain={};state.queries.push(query);
 for(const method of["select","eq","order","limit"])chain[method]=(...args)=>{query.ops.push([method,...args]);return chain;};
 chain.then=(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);return chain;
}};
const date="2026-11-01T08:00:00Z",room="00000000-0000-4000-8000-000000000099";
const kinds=["communityPosts","communityComments","peerSpaceMessages","peerSpaceControls"];
function initial(id){const label=id===A?"A":"B",suffix=id===A?"111":"211";
 return{
 communityPosts:[{id:"00000000-0000-4000-8000-000000000"+suffix,author_user_id:id,title:label+" OWN POST",body:label+" OWN POST BODY",moderation_status:"published",created_at:date}],
 communityComments:[{id:"00000000-0000-4000-8000-000000000"+(Number(suffix)+1),author_user_id:id,post_id:"00000000-0000-4000-8000-000000000999",body:label+" OWN COMMENT BODY",moderation_status:"published",created_at:date}],
 peerSpaceMessages:[{id:"00000000-0000-4000-8000-000000000"+(Number(suffix)+2),room_id:room,body:label+" OWN PEER BODY",moderation_status:"visible",created_at:date,deleted_at:null}],
 peerSpaceControls:[{id:"00000000-0000-4000-8000-000000000"+(Number(suffix)+3),room_id:room,control_type:"mute",created_at:date}],
 };}
const records={[A]:initial(A),[B]:initial(B)};
function exported(id){const data=JSON.parse(JSON.stringify(state.options.contradictoryRead?initial(id):records[id]));
 if(state.options.manyPosts)data.communityPosts=Array.from({length:21},(_,i)=>({...data.communityPosts[0],id:"00000000-0000-4000-8000-"+String(500+i).padStart(12,"0"),body:data.communityPosts[0].body+" "+"LongUnbrokenContent".repeat(12)}));
 if(state.options.empty)for(const kind of kinds)data[kind]=[];
 if(Object.hasOwn(state.options,"deletedAtOverride"))data.peerSpaceMessages[0].deleted_at=state.options.deletedAtOverride;
 if(state.options.malformedRead==="missing")delete data.peerSpaceControls;
 if(state.options.malformedRead==="row")data.communityPosts[0].created_at="not-a-date";
 return{format:"YouthTempo account data export",formatVersion:1,account:{id:state.options.malformedRead==="owner"?B:id},data:{...data,messages:[{body:"UNRELATED PRIVATE EXPORT DATA"}],supportCases:[],wechatIdentities:[{openid:"UNRELATED PRIVATE EXPORT DATA"}]}};
}
function metadata(id){return{profile:{id,display_name:state.options.noName?"":id===A?"Synthetic Account A":"Synthetic Account B",email:"synthetic@fixture.invalid",role:state.options.role||"学生",school_id:null},displayRole:state.options.role||"学生",hasSchool:false,adminAccess:null,schoolMemberships:[],studentAgeBand:"14_17",linkedChildren:[],assignedStudents:[],assignedTeachers:[],linkedGuardians:[]};}
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
const contracts={"/api/community/posts":["communityPosts","postId","ok"],"/api/community/comments":["communityComments","commentId","ok"],"/api/peer-space/messages":["peerSpaceMessages","messageId","deleted"],"/api/peer-space/controls":["peerSpaceControls","controlId","removed"]};
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),"https://own-mock.invalid"),method=init.method||"GET";
 if(url.origin!=="https://own-mock.invalid")return forbidden("external fetch "+url.origin);
 const id=(init.headers?.authorization||"").replace("Bearer synthetic:","");
 const body=init.body?JSON.parse(String(init.body)):null;
 state.calls.push({path:url.pathname,method,actor:id,cache:init.cache||null,body});
 if(!id||id!==actor)return response({error:"Synthetic sign-in required"},401);
 if(url.pathname==="/api/account/status"&&method==="GET")return response(metadata(id));
 if(url.pathname==="/api/account/consent"&&method==="GET")return state.options.consentError?response({error:"Synthetic consent unavailable"},503):response({role:"student",policyVersion:"2026-08-28",consent:{studentUserId:id,studentName:"Synthetic",ageBand:"14_17",consentBasis:"student_self_pilot",policyVersion:"2026-08-28",status:"withdrawn",studentAssentedAt:date,guardianUserId:null,guardianConsentedAt:null,withdrawnAt:date,hasLinkedGuardian:false},children:[]});
 if(url.pathname==="/api/account/data"&&method==="GET"){
  const result=state.options.readFailure?response({error:"Synthetic export refusal"},state.options.readFailure):response(exported(id));
  if(state.options.holdJson){const value=await result.json();result.json=()=>hold("json",value);}
  return state.options.holdRead?hold("read",result):result;
 }
 if(method==="DELETE"&&contracts[url.pathname]){
  const[kind,param,resultKey]=contracts[url.pathname],target=records[id][kind].find(row=>row.id===body[param]);
  if(state.options.deleteFailure)return response({error:"Synthetic deletion refused"},state.options.deleteFailure);
  if(!target)return response({error:"Synthetic unavailable target"},404);
  if(state.options.commitDelete!==false){if(kind==="peerSpaceControls")records[id][kind]=records[id][kind].filter(row=>row.id!==body[param]);else{target.moderation_status=kind==="peerSpaceMessages"?"deleted":"removed";if(kind==="peerSpaceMessages")target.deleted_at=date;}}
  if(state.options.networkDelete)throw new Error("Synthetic transport interruption after potential commit");
  const result=response(state.options.malformedDelete?{}:{[resultKey]:true});
  return state.options.holdDelete?hold("delete",result):result;
 }
 return forbidden(method+" "+url.pathname);
};
window.XMLHttpRequest=class{constructor(){forbidden("XMLHttpRequest");}};
window.WebSocket=class{constructor(){forbidden("WebSocket");}};
navigator.sendBeacon=()=>forbidden("sendBeacon");
URL.createObjectURL=()=>{const value="blob:synthetic/"+(state.created.length+1);state.created.push(value);return value;};
URL.revokeObjectURL=url=>state.revoked.push(url);
HTMLAnchorElement.prototype.click=function(){state.downloads.push(this.download);};
window.confirm=()=>forbidden("native confirm");
window.__own={state,set:(key,value)=>{state.options[key]=value;},actor:changeActor,sessionError:value=>{sessionError=value;},reset:id=>{records[id]=initial(id);},
 release:(kind="all",one=false)=>{const selected=state.pending.filter(item=>kind==="all"||item.kind===kind).slice(0,one?1:undefined);state.pending=state.pending.filter(item=>!selected.includes(item));selected.forEach(item=>item.release());},
 visibility:value=>{Object.defineProperty(document,"visibilityState",{configurable:true,value});Object.defineProperty(document,"hidden",{configurable:true,value:value==="hidden"});document.dispatchEvent(new Event("visibilitychange"));},
 focus:()=>window.dispatchEvent(new Event("focus")),
};
`;
const virtual:Record<string,string>={
 "own:runtime":runtime,
 "@/lib/supabaseClient":`import {client,syntheticSignOut} from "own:runtime";export const getSupabase=()=>client;export const isSupabaseConfigured=()=>true;export const signOutSupabaseSession=syntheticSignOut;`,
 "@/lib/clientMonitoring":`export const reportClientOperationFailure=()=>{};`,
 "@/lib/emailOtp":`export const emailOtpLength=8;export const isOtpRateLimitError=()=>false;export const otpRequestErrorMessage=()=>"Synthetic OTP error";export const otpVerificationErrorMessage=otpRequestErrorMessage;`,
 "@/components/ProfessionalVerificationCard":`export const ProfessionalVerificationCard=()=>null;`,
 "@/components/AgePathWorkspace":`export const AgePathWorkspace=()=>null;`,
 "@/components/AiTransparencyNotice":`export const AiGeneratedLabel=()=>null;`,
 "next/router":`export const useRouter=()=>({locale:window.__ownOptions.locale,isReady:true,query:{},asPath:"/account",replace:async()=>false});`,
 "next/link":`import {jsx} from "react/jsx-runtime";export default function Link({href,children,...props}){return jsx("a",{...props,href,children});}`,
 "next/image":`import {jsx} from "react/jsx-runtime";export default function Image({priority,loading,src,alt,...props}){return jsx("div",{...props,role:"img","aria-label":alt,"data-source":src});}`,
};
async function bundle(){
 const modules:Record<string,{source:string;dependencies:Record<string,string>}>= {};
 const allowed=new Set(["views/account/page.tsx","components/SectionHeader.tsx","lib/useSessionActor.ts","lib/sweetPersistenceProtocol.ts","lib/cloudRecords.ts","lib/sweetRecordDays.ts","lib/guardianAccessPolicy.ts","lib/navigation.ts","lib/sessionSignOut.ts","lib/peerSpaceClient.ts","lib/checkInHistoryCopy.ts","lib/i18n/client.tsx","lib/i18n/config.ts","lib/i18n/dictionaries.ts","locales/zh-CN.json","locales/en.json"]);
 async function add(id:string,file?:string):Promise<string>{
  if(modules[id])return id;
  const source=virtual[id]??await readFile(file!,"utf8");
  const compiled=file?.endsWith(".json")?`module.exports=${source};`:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const entry=modules[id]={source:compiled,dependencies:{} as Record<string,string>};
  for(const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)){
   const name=match[1];
   if(virtual[name])entry.dependencies[name]=await add(name);
   else if(name.startsWith("@/")){const base=name.slice(2),local=[base,base+".ts",base+".tsx"].find(p=>allowed.has(p));if(!local)throw new Error("Unmocked application module: "+name);entry.dependencies[name]=await add(name,path.join(root,local));}
   else if(/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name)||(file?.includes("node_modules")&&name.startsWith("."))){const resolved=createRequire(file||path.join(root,"package.json")).resolve(name);if(!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved))throw new Error("Disallowed vendor "+name);entry.dependencies[name]=await add(resolved,resolved);}
   else throw new Error("Unmocked import: "+name);
  }return id;
 }
 await add("own:runtime");
 await add("own:route",path.join(root,"views/account/page.tsx"));
 await add("@/lib/cloudRecords",path.join(root,"lib/cloudRecords.ts"));await add("@/lib/i18n/client",path.join(root,"lib/i18n/client.tsx"));
 for(const name of ["react-dom/client","react/jsx-runtime"])await add(name,createRequire(path.join(root,"package.json")).resolve(name));
 return `(function(){const process={env:{NODE_ENV:"production"}};const factories={${Object.entries(modules).map(([id,e])=>`${JSON.stringify(id)}:[function(module,exports,require){\n${e.source}\n},${JSON.stringify(e.dependencies)}]`).join(",\n")}};const cache={};function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};const [factory,deps]=factories[id];factory(module,module.exports,(name)=>{if(!deps[name])throw new Error("Unmocked require "+name);return load(deps[name]);});return module.exports;}
 load("own:runtime");const ui=window.__own;
 const jsx=load("react/jsx-runtime").jsx;const root=load("react-dom/client").createRoot(document.getElementById("root"));ui.unmount=()=>root.unmount();root.render(jsx(load("@/lib/i18n/client").I18nProvider,{children:jsx("main",{children:jsx(load("own:route").default,{})})}));})();`;

}
async function css(){
 const config=ts.transpileModule(await readFile(path.join(root,"tailwind.config.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const configModule={exports:{} as {default?:Record<string,unknown>}};new Function("module","exports",config)(configModule,configModule.exports);
 const files=["views/account/page.tsx","components/SectionHeader.tsx"];
 const raw=(await Promise.all(files.map(f=>readFile(path.join(root,f),"utf8")))).join("\n");
 return(await postcss([tailwindcss({...configModule.exports.default,content:[{raw,extension:"tsx"}]}),autoprefixer]).process(await readFile(path.join(root,"views/globals.css"),"utf8"),{from:undefined})).css;
}
export async function openOwnContent(page:Page,options:OwnOptions){
 const network:string[]=[],errors:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/*",route=>{network.push(route.request().url());return route.abort("blockedbyclient");});
 await page.setContent(`<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"></head><body><div id="root"></div></body></html>`);
 await page.evaluate(options=>Object.assign(window,{__ownOptions:options}),options);
 cssPromise??=css();await page.addStyleTag({content:await cssPromise});await page.addScriptTag({content:await bundle()});
 await expect(page.locator("#root main")).toBeVisible();return{network,errors};
}
export function controlOwn(page:Page,action:string,...args:unknown[]){return page.evaluate(({action,args})=>(window as unknown as {__own:Record<string,(...values:unknown[])=>unknown>}).__own[action](...args),{action,args});}
export function ownState(page:Page){return page.evaluate(()=>{const s=(window as unknown as {__own:{state:{calls:Array<{path:string;method:string;actor:string;cache:string|null;body:Record<string,unknown>|null}>;authCalls:Array<{kind:string;actor:string}>;queries:Array<{table:string;ops:unknown[]}>;unexpected:string[];pending:Array<{id:number;kind:string}>;created:string[];revoked:string[];downloads:string[]}}}).__own.state;return{...s,pending:s.pending.map(p=>({id:p.id,kind:p.kind}))};});}
