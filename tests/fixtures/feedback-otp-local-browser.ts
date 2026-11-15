import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { expect, type Page } from "@playwright/test";

export type LocalOptions = { locale: "zh-CN" | "en"; route: "feedback" | "account" | "inline"; profileName?: string | null };
const root = process.cwd();
const cssCache = new Map<string, Promise<string>>();
const runtime = String.raw`
import {useState,useEffect} from "react";
export const state={options:window.__localOptions,calls:[],authCalls:[],unexpected:[],pending:[],completed:[],navigation:[],scrolls:[],identityFailure:false};
const A="00000000-0000-4000-8000-000000000011",B="00000000-0000-4000-8000-000000000012";
let actor=state.options.route==="feedback"?A:"",seq=0,tokenRevision=0;
const listeners=new Set();
const user=()=>actor?{id:actor,email:"synthetic@fixture.invalid"}:null;
const session=()=>actor?{user:user(),access_token:"synthetic:"+actor+":"+tokenRevision}:null;
function forbidden(name){state.unexpected.push(name);throw new Error("Unmocked synthetic operation: "+name);}
function hold(kind,value){return new Promise(resolve=>state.pending.push({id:++seq,kind,release:()=>{state.completed.push({id:seq,kind});resolve(value);}}));}
export function changeActor(id){actor=id;listeners.forEach(fn=>fn(id?"SIGNED_IN":"SIGNED_OUT",session()));}
const date="2026-11-01T08:00:00Z",version="2026-08";
function row(id,form){return{id:"feedback:"+id,role:"student",form_version:version,overall_experience:form?.overallExperience??4,clarity:form?.clarity??4,safety:form?.safety??4,most_helpful:form?.mostHelpful.trim()??(id===A?"A saved feedback":"B saved feedback"),hard_to_use:form?.hardToUse.trim()??"",suggestion:form?.suggestion.trim()??"",may_contact:form?.mayContact??false,created_at:date,updated_at:date};}
const rows={[A]:row(A),[B]:row(B)};
function error(){const e=state.options.authError;if(e?.type==="TypeError")return new TypeError(e.message);return e||null;}
export const client={auth:{
 getSession:async()=>{state.authCalls.push({kind:"session",actor});const value={data:{session:session()},error:state.identityFailure?new Error("Synthetic identity unavailable"):null};if(state.options.holdToken){state.options.holdToken=false;return hold("token",value);}return value;},
 getUser:async()=>({data:{user:user()},error:null}),
 onAuthStateChange:fn=>{listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 signInWithOtp:async params=>{state.authCalls.push({kind:"send",trimmed:params.email===params.email.trim(),create:params.options.shouldCreateUser});const value={error:error()};return state.options.holdAuth?hold("send",value):value;},
 verifyOtp:async params=>{state.authCalls.push({kind:"verify",length:params.token.length,trimmed:params.email===params.email.trim(),type:params.type});const value={data:{user:null},error:error()};if(!value.error){changeActor(A);value.data.user=user();}return state.options.holdAuth?hold("verify",value):value;},
 exchangeCodeForSession:()=>forbidden("exchangeCode"),
},from:table=>{
 if(!["sweet_records","wechat_identities"].includes(table))return forbidden("SDK table "+table);
 const chain={};for(const method of["select","eq","order","limit"])chain[method]=()=>chain;
 chain.then=(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);return chain;
}};
function metadata(id){const displayName=Object.prototype.hasOwnProperty.call(state.options,"profileName")?state.options.profileName:"Synthetic account";return{profile:{id,display_name:displayName,email:"synthetic@fixture.invalid",role:"学生",school_id:null},displayRole:"学生",hasSchool:false,adminAccess:null,schoolMemberships:[],studentAgeBand:"14_17",linkedChildren:[],assignedStudents:[],assignedTeachers:[],linkedGuardians:[]};}
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),"https://feedback-otp-mock.invalid"),method=init.method||"GET";
 if(url.origin!=="https://feedback-otp-mock.invalid")return forbidden("external fetch");
 const id=(init.headers?.authorization||"").split(":")[1]||"",body=init.body?JSON.parse(String(init.body)):null;
 state.calls.push({path:url.pathname,method,actor:id,body});
 if(!id||id!==actor)return response({error:"Synthetic sign-in required"},401);
 if(url.pathname==="/api/pilot-feedback"){
  if(method==="GET"){const value=response({role:"student",version,feedback:rows[id]});return state.options.holdRead?hold("read",value):value;}
  if(method!=="POST")return forbidden(method+" feedback");
  const mode=state.options.postMode||"success";let value;
  if(mode==="refused")value=response({error:"Synthetic refusal"},403);
  else if(mode==="server")value=response({error:"Synthetic private fault"},503);
  else {rows[id]=row(id,body);value=response(mode==="missing"?{}:{role:"student",version,feedback:mode==="mismatch"?row(id):rows[id],notice:"已经收到，谢谢你认真告诉我们。"});}
  if(mode==="json")value.json=async()=>{throw new SyntaxError("Synthetic interrupted JSON");};
  if(state.options.holdPost)value=await hold("post",value);
  if(mode==="network")throw new TypeError("Failed to fetch");
  return value;
 }
 if(method!=="GET")return forbidden(method+" "+url.pathname);
 if(url.pathname==="/api/account/status")return response(metadata(id));
 if(url.pathname==="/api/account/consent")return response({role:"student",policyVersion:"2026-08-28",consent:{studentUserId:id,studentName:"Synthetic",ageBand:"14_17",consentBasis:"student_self_pilot",policyVersion:"2026-08-28",status:"active",studentAssentedAt:date,guardianUserId:null,guardianConsentedAt:null,withdrawnAt:null,hasLinkedGuardian:false},children:[]});
 return forbidden(method+" "+url.pathname);
};
window.XMLHttpRequest=class{constructor(){forbidden("XMLHttpRequest");}};
window.WebSocket=class{constructor(){forbidden("WebSocket");}};
navigator.sendBeacon=()=>forbidden("sendBeacon");
window.scrollTo=options=>state.scrolls.push(options);
export function InlineFixture(){const[,rerender]=useState(0);useEffect(()=>{const fn=()=>rerender(v=>v+1);listeners.add(fn);return()=>listeners.delete(fn);},[]);
 return {phase:actor?"other":"signed_out",userId:actor,busy:false,refresh:async()=>{},trackRequest:()=>()=>true,isSameActor:id=>id===actor,assent:()=>forbidden("assent"),completeProfile:()=>forbidden("profile")};}
window.__local={state,actor:changeActor,refreshToken:()=>{++tokenRevision;listeners.forEach(fn=>fn("TOKEN_REFRESHED",session()));},
 set:(key,value)=>{state.options[key]=value;},
 release:(kind="all",id)=>{const chosen=state.pending.filter(p=>(kind==="all"||p.kind===kind)&&(id===undefined||p.id===id));state.pending=state.pending.filter(p=>!chosen.includes(p));chosen.forEach(p=>p.release());},
 identityFailure:async()=>{state.identityFailure=true;await window.__local.actualActor.refreshIdentity();},
};
`;
const virtual: Record<string, string> = {
  "local:runtime": runtime,
  "local:inline": `import {InlineStudentConsent} from "@/components/InlineStudentConsent";import{InlineFixture}from"local:runtime";import{jsx}from"react/jsx-runtime";export default function App(){return jsx(InlineStudentConsent,{controller:InlineFixture()});}`,
  "@/lib/supabaseClient": `import {client,changeActor} from "local:runtime";export const getSupabase=()=>client;export const isSupabaseConfigured=()=>true;export const signOutSupabaseSession=async()=>changeActor("");`,
  "@/lib/clientMonitoring": `export const reportClientOperationFailure=()=>{};`,
  "@/components/ProfessionalVerificationCard": `export const ProfessionalVerificationCard=()=>null;`,
  "@/components/AgePathWorkspace": `export const AgePathWorkspace=()=>null;`,
  "@/components/AiTransparencyNotice": `export const AiGeneratedLabel=()=>null;`,
  "next/router": `export const useRouter=()=>({locale:window.__localOptions.locale,isReady:true,query:{},asPath:(window.__localOptions.locale==="en"?"/en":"")+"/account",replace:async(path)=>{window.__local.state.navigation.push(path);return true;}});`,
  "next/link": `import{jsx}from"react/jsx-runtime";export default function Link({href,children,...props}){return jsx("a",{...props,href,children});}`,
  "next/image": `import{jsx}from"react/jsx-runtime";export default function Image({priority,loading,src,alt,...props}){return jsx("div",{...props,role:"img","aria-label":alt,"data-source":src});}`,
};

async function bundle(route: LocalOptions["route"]) {
  const modules: Record<string, { source: string; dependencies: Record<string, string> }> = {};
  const allowed = new Set(["views/feedback/page.tsx", "views/account/page.tsx", "components/InlineStudentConsent.tsx", "components/PageHero.tsx", "components/SectionHeader.tsx", "lib/emailOtp.ts", "lib/pilotFeedback.ts", "lib/useSessionActor.ts", "lib/sweetPersistenceProtocol.ts", "lib/cloudRecords.ts", "lib/sweetRecordDays.ts", "lib/guardianAccessPolicy.ts", "lib/navigation.ts", "lib/sessionSignOut.ts", "lib/peerSpaceClient.ts", "lib/checkInHistoryCopy.ts", "lib/i18n/client.tsx", "lib/i18n/config.ts", "lib/i18n/dictionaries.ts", "locales/zh-CN.json", "locales/en.json"]);
  async function add(id: string, file?: string): Promise<string> {
    if (modules[id]) return id;
    const source = virtual[id] ?? await readFile(file!, "utf8");
    const compiled = file?.endsWith(".json") ? `module.exports=${source};` : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const entry = modules[id] = { source: compiled, dependencies: {} as Record<string, string> };
    for (const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (virtual[name]) entry.dependencies[name] = await add(name);
      else if (name.startsWith("@/")) {
        const base = name.slice(2), local = [base, base + ".ts", base + ".tsx"].find(p => allowed.has(p));
        if (!local) throw new Error("Unmocked application module: " + name);
        entry.dependencies[name] = await add(name, path.join(root, local));
      } else if (/^(react(?:-dom)?(?:\/.*)?|scheduler(?:\/.*)?)$/.test(name) || (file?.includes("node_modules") && name.startsWith("."))) {
        const resolved = createRequire(file || path.join(root, "package.json")).resolve(name);
        if (!/node_modules\/(?:react|react-dom|scheduler)\//.test(resolved)) throw new Error("Disallowed vendor: " + name);
        entry.dependencies[name] = await add(resolved, resolved);
      } else throw new Error("Unmocked import: " + name);
    }
    return id;
  }
  await add("local:runtime");
  const entry = route === "inline" ? "local:inline" : "local:route";
  await add(entry, route === "inline" ? undefined : path.join(root, `views/${route === "account" ? "account" : "feedback"}/page.tsx`));
  await add("@/lib/i18n/client", path.join(root, "lib/i18n/client.tsx"));
  for (const name of ["react-dom/client", "react/jsx-runtime"]) await add(name, createRequire(path.join(root, "package.json")).resolve(name));
  return `(function(){const process={env:{NODE_ENV:"production"}};const factories={${Object.entries(modules).map(([id, e]) => `${JSON.stringify(id)}:[function(module,exports,require){\n${e.source}\n},${JSON.stringify(e.dependencies)}]`).join(",\n")}};const cache={};function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};const[factory,deps]=factories[id];factory(module,module.exports,name=>{if(!deps[name])throw new Error("Unmocked require: "+name);return load(deps[name]);});return module.exports;}
  load("local:runtime");const ui=window.__local;
  ${route === "inline" ? "" : `const hooks=load("@/lib/useSessionActor");const original=hooks.useSessionActor;hooks.useSessionActor=function(){const actor=original();ui.actualActor=actor;return actor;};`}
  const jsx=load("react/jsx-runtime").jsx;const root=load("react-dom/client").createRoot(document.getElementById("root"));ui.unmount=()=>root.unmount();root.render(jsx(load("@/lib/i18n/client").I18nProvider,{children:jsx("main",{children:jsx(load(${JSON.stringify(entry)}).default,{})})}));})();`;
}

async function css() {
  const config = ts.transpileModule(await readFile(path.join(root, "tailwind.config.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} as { default?: Record<string, unknown> } };
  new Function("module", "exports", config)(configModule, configModule.exports);
  const raw = (await Promise.all(["views/feedback/page.tsx", "views/account/page.tsx", "components/InlineStudentConsent.tsx", "components/PageHero.tsx", "components/SectionHeader.tsx"].map(f => readFile(path.join(root, f), "utf8")))).join("\n");
  return (await postcss([tailwindcss({ ...configModule.exports.default, content: [{ raw, extension: "tsx" }] }), autoprefixer]).process(await readFile(path.join(root, "views/globals.css"), "utf8"), { from: undefined })).css;
}

export async function openLocal(page: Page, options: LocalOptions) {
  const network: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { network.push(route.request().url()); return route.abort("blockedbyclient"); });
  await page.setContent(`<html lang="${options.locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'"></head><body><div id="root"></div></body></html>`);
  await page.evaluate(options => Object.assign(window, { __localOptions: options }), options);
  if (!cssCache.has("all")) cssCache.set("all", css());
  await page.addStyleTag({ content: await cssCache.get("all")! });
  await page.addScriptTag({ content: await bundle(options.route) });
  await expect(page.locator("#root main")).toBeVisible();
  return { network, errors };
}

export async function controlLocal(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => (window as unknown as { __local: Record<string, (...values: unknown[]) => unknown> }).__local[action](...args), { action, args });
}
export async function localState(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __local: { state: { calls: Array<{ path: string; method: string; actor: string; body: Record<string, unknown> | null }>; authCalls: Array<{ kind: string; length?: number; trimmed?: boolean }>; unexpected: string[]; pending: Array<{ id: number; kind: string }>; completed: Array<{ id: number; kind: string }>; scrolls: unknown[]; navigation: string[] } } }).__local.state;
    return { ...s, pending: s.pending.map(p => ({ id: p.id, kind: p.kind })) };
  });
}
