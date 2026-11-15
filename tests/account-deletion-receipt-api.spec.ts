import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

type Row = Record<string, any>;
const owner = "12345678-1234-4234-8234-123456789abc";
const other = "22345678-1234-4234-8234-123456789abc";
const email = "synthetic-owner@example.invalid";
const sensitive = "PRIVATE_PROVIDER_SECRET";
type AuthMode = "success" | "rejected" | "network" | "committed-error";
function receipt() { return { operationId: randomUUID(), secret: randomBytes(32).toString("base64url") }; }
function fixture(mode: AuthMode = "success") {
  const state = { present: true, lookup: "normal", deleteCalls: 0, signOutCalls: 0, completedFailure: false,
    rateMode: "allow", rateCalls: [] as Row[], lookups: 0, auditHang: false,
    authUser: owner as string | null, afterDelete: () => {}, mutations: [] as Array<{ table: string; kind: string; filters: Array<[string, string, unknown]> }> };
  const tables: Record<string, Row[]> = { profiles: [{ id: owner, role: "家长", email }], account_deletion_audits: [] };
  const field = (row: Row, key: string) => key.split(/->>?/).reduce((value: any, segment) => value?.[segment], row);
  const admin: any = {
    rpc: (_name: string, args: Row) => ({ abortSignal: async () => { state.rateCalls.push(args); return { data: [{ allowed: state.rateMode !== "deny", remaining: 29, reset_at: new Date(Date.now()+60_000).toISOString() }], error: state.rateMode === "error" ? {message:sensitive}:null }; } }),
    from(table: string) {
      tables[table] ??= [];
      const filters: Array<[string, string, unknown]> = []; let kind = "select"; let value: any; let representation = false; let single = false;
      let signal: AbortSignal | undefined;let from=0,to=999;
      let maximum = Infinity;
      const chain: any = {
        select() { representation = true; return chain; }, insert(input: any) { kind = "insert"; value = input; return chain; },
        update(input: any) { kind = "update"; value = input; return chain; }, delete() { kind = "delete"; return chain; },
        eq(key: string, v: unknown) { filters.push(["eq", key, v]); return chain; }, neq(key: string, v: unknown) { filters.push(["neq", key, v]); return chain; },
        in(key: string, v: unknown) { filters.push(["in", key, v]); return chain; }, lte(key: string, v: unknown) { filters.push(["lte", key, v]); return chain; },
        gt(key:string,v:unknown){filters.push(["gt",key,v]);return chain;},range(start:number,end:number){from=start;to=end;return chain;},
        limit(value: number) { maximum = value; return chain; },
        is(key: string, v: unknown) { filters.push(["is", key, v]); return chain; }, order() { return chain; },
        abortSignal(value: AbortSignal) { signal=value; return chain; },
        single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
        then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
          if(state.auditHang&&table==="account_deletion_audits"&&kind==="select")return new Promise((_r,rejectHang)=>{signal?.addEventListener("abort",()=>rejectHang(new Error(sensitive)),{once:true});}).then(resolve,reject);
          const selected = tables[table].filter(row => filters.every(([op,key,v]) => op === "eq" || op === "is" ? field(row,key) === v : op === "neq" ? field(row,key) !== v : op === "in" ? (v as unknown[]).includes(field(row,key)) :op==="gt"?field(row,key)>v!: field(row,key) <= v!));
          let data = kind==="select"?selected.slice(from,Math.min(to+1,from+maximum)):selected; let error: any = null;
          if (kind !== "select") state.mutations.push({ table, kind, filters });
          if (kind === "insert") {
            const item = { id: randomUUID(), ...JSON.parse(JSON.stringify(value)) };
            if (tables[table].some(row => row.id === item.id)) { error = { code: "23505", message: sensitive }; data = []; }
            else { tables[table].push(item); data = [item]; }
          }
          if (kind === "update") {
            if (state.completedFailure && value.status === "completed") { error = { message: sensitive }; data = []; }
            else selected.forEach(row => Object.assign(row, JSON.parse(JSON.stringify(value))));
          }
          if (kind === "delete") tables[table] = tables[table].filter(row => !selected.includes(row));
          return Promise.resolve({ data: representation ? single ? data[0] ?? null : data : null, error }).then(resolve, reject);
        },
      };
      return chain;
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    auth: { admin: {
      signOut: async () => { state.signOutCalls++; return { error: null }; },
      getUserById: async (id: string) => {
        state.lookups++;
        if (state.lookup === "throw") throw new Error(sensitive);
        if (state.lookup === "provider404") return { data: { user: null }, error: { status: 404, code: "route_not_found", message: sensitive } };
        return state.present ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { status: 404, code: "user_not_found" } };
      },
      deleteUser: async () => {
        state.deleteCalls++;
        if (mode === "network") throw new Error(sensitive);
        if (mode === "rejected") return { error: { status: 500, message: sensitive } };
        state.present = false; state.afterDelete();
        return { error: mode === "committed-error" ? { status: 500, message: sensitive } : null };
      },
    } },
  };
  return { state, tables, admin };
}

async function modules(mock: ReturnType<typeof fixture>) {
  const cache = new Map<string, Row>();
  const sourcePaths = new Set(["lib/accountDeletionReceiptServer.ts", "lib/rateLimit.ts", "lib/studentMessageAccess.ts", "pages/api/account/data.ts", "pages/api/account/deletion-status.ts"]);
  async function load(file: string): Promise<Row> {
    if (cache.has(file)) return cache.get(file)!;
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    const helper = file.startsWith("pages/api/account/") ? await load("lib/accountDeletionReceiptServer.ts") : null;
    const messageAccess = file === "pages/api/account/data.ts" ? await load("lib/studentMessageAccess.ts") : null;
    const limiter = file === "pages/api/account/deletion-status.ts" ? await load("lib/rateLimit.ts") : null;
    const module = { exports: {} as Row }; cache.set(file, module.exports);
    const requireMock = (name: string) => {
      if (name === "node:crypto") return require("node:crypto");
      if (name === "@/lib/accountDeletionReceiptServer") return helper;
      if (name === "@/lib/studentMessageAccess") return messageAccess;
      if (name === "@/lib/rateLimit") return limiter;
      if (name === "@/lib/supabaseServer") return { getSupabaseAdmin: () => mock.admin,
        getAuthenticatedUser: async () => mock.state.authUser ? { id: mock.state.authUser, email, created_at: "2026-01-01T00:00:00Z" } : null };
      if (name === "@/lib/accountDataPolicy") return { ACCOUNT_DATA_POLICY_VERSION: "2026-08-03", accountDataRetention: {} };
      if (name === "@/lib/operationalMonitoring") return { reportOperationalError: async () => {} };
      if (name === "@/lib/supportWorkflow") return { transitionSupportCase: async () => { throw new Error("Unexpected support transition"); } };
      if (name === "@/lib/i18n/server") return { getRequestLocale: (req: Row) => req.body?.locale === "en" ? "en" : "zh-CN",
        getServerTranslator: (locale: string) => (key: string) => key.split(".").reduce((v: any,s) => v[s], locale === "en" ? en : zh) };
      throw new Error(`Unexpected import ${name}`);
    };
    expect(sourcePaths.has(file)).toBe(true);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireMock, Buffer, Date, AbortSignal, setTimeout, clearTimeout, process: {env:{RATE_LIMIT_SECRET:"synthetic-secret"}},
      console: { error() {}, warn() {} } }, { filename: file });
    return module.exports;
  }
  return { data: await load("pages/api/account/data.ts"), status: await load("pages/api/account/deletion-status.ts"), helper: await load("lib/accountDeletionReceiptServer.ts") };
}
async function invoke(mod: Row, method: string, body: Row = {}) {
  const result = { code: 200, body: {} as any, headers: {} as Row };
  const res: any = { setHeader: (k: string,v: unknown) => { result.headers[k] = v; }, status: (v: number) => { result.code=v; return res; }, json: (v: unknown) => { result.body=v; return res; } };
  await mod.default({ method, headers: { authorization: "Bearer SYNTHETIC" }, body, query: {}, cookies: {},socket:{remoteAddress:"127.0.0.1"} }, res);
  expect(JSON.stringify(result.body)).not.toContain(sensitive);
  return result;
}
const deletionBody = (r?: Row) => ({ confirmationEmail: email, acknowledge: true, ...(r ? { receipt: r } : {}) });

test("实际handler旧客户端注销保留契约；不提前withdraw、revoke或global signOut", async () => {
  const f=fixture();const m=await modules(f);const result=await invoke(m.data,"DELETE",deletionBody());
  expect(result.body).toEqual({deleted:true});expect(f.state.signOutCalls).toBe(0);
  expect(f.state.mutations.some(q=>["student_consents","student_consent_events","guardian_student_links"].includes(q.table))).toBe(false);
  expect(f.tables.account_deletion_audits[0]).toMatchObject({status:"completed"});
});
test("receipt仅存hash/24h过期；实际POST只读cap可核实完成", async () => {
  const f=fixture();const m=await modules(f);const r=receipt();await invoke(m.data,"DELETE",deletionBody(r));
  const row=f.tables.account_deletion_audits[0];expect(row.id).toBe(r.operationId);expect(JSON.stringify(row)).not.toContain(r.secret);expect(JSON.stringify(row)).not.toContain(email);expect(JSON.stringify(row)).not.toContain(owner);
  expect(Date.parse(row.deletion_summary.receipt.expiresAt)-Date.now()).toBeGreaterThan(86_390_000);
  const before=f.state.mutations.length;const status=await invoke(m.status,"POST",{...r,subjectUserId:owner});
  expect(status.body).toEqual({state:"completed"});expect(status.headers["Cache-Control"]).toContain("no-store");expect(f.state.mutations.length).toBe(before);
});
for(const mode of ["rejected","network"] as const)for(const locale of ["zh-CN","en"]){
  test(`${mode}/${locale} Auth失败保留pending审计、当前not_deleted与重试能力`,async()=>{
    const f=fixture(mode);const m=await modules(f);const r=receipt();const result=await invoke(m.data,"DELETE",{...deletionBody(r),locale});
    expect(result.code).toBe(503);expect(result.body.deletionState).toBe("not_deleted");expect(f.state.present).toBe(true);expect(f.state.signOutCalls).toBe(0);
    expect(f.tables.account_deletion_audits[0]).toMatchObject({status:"cleanup_required",completed_at:null});
    expect((await invoke(m.status,"POST",{...r,subjectUserId:owner})).body.state).toBe("not_deleted");
  });
}
test("Auth已提交但错误响应仍按真实缺席完成；provider错误不能当缺席",async()=>{
  const f=fixture("committed-error");const m=await modules(f);expect((await invoke(m.data,"DELETE",deletionBody(receipt()))).body.deleted).toBe(true);
  const g=fixture("network");g.state.lookup="provider404";const n=await modules(g);const result=await invoke(n.data,"DELETE",deletionBody(receipt()));expect(result.body.deletionState).toBe("unknown");
});
test("审计完成失败返回已删待清理，cap不能假报completed",async()=>{
  const f=fixture();f.state.completedFailure=true;const m=await modules(f);const r=receipt();expect((await invoke(m.data,"DELETE",deletionBody(r))).body).toEqual({deleted:true,cleanupPending:true});
  expect((await invoke(m.status,"POST",{...r,subjectUserId:owner})).body).toEqual({state:"deleted_cleanup_pending"});
});
test("非本人前缀的历史证据path不删除且保留清理待办",async()=>{
  const f=fixture();f.tables.support_staff_applications=[{user_id:owner,evidence_path:"another-owner/private-document.pdf"}];
  const m=await modules(f);expect((await invoke(m.data,"DELETE",deletionBody(receipt()))).body).toEqual({deleted:true,cleanupPending:true});
  expect(f.tables.account_deletion_audits[0].status).toBe("cleanup_required");
});
test("并发同op30s内拒绝；过期本人重试CAS，迟到旧attempt不能完成新attempt",async()=>{
  const f=fixture("rejected");const m=await modules(f);const r=receipt();await invoke(m.data,"DELETE",deletionBody(r));const first=structuredClone(f.tables.account_deletion_audits[0]);
  const busy=await invoke(m.data,"DELETE",deletionBody(r));expect(busy.code).toBe(409);expect(busy.body.deletionState).toBe("unknown");expect(busy.body.retryAfter).toBeGreaterThan(0);expect(f.state.deleteCalls).toBe(1);
  f.tables.account_deletion_audits[0].deletion_summary.receipt.leaseUntil=new Date(Date.now()-1000).toISOString();
  await invoke(m.data,"DELETE",deletionBody(r));expect(f.state.deleteCalls).toBe(2);expect(f.tables.account_deletion_audits[0].deletion_summary.receipt.attemptId).not.toBe(first.deletion_summary.receipt.attemptId);
  const completed=await m.helper.completeDeletionAudit(f.admin,{id:first.id,attemptId:first.deletion_summary.receipt.attemptId,summary:first.deletion_summary});expect(completed).toBe(false);expect(f.tables.account_deletion_audits[0].status).toBe("cleanup_required");
});
test("同op不能跨主体/secret覆盖或降级completed",async()=>{
  const f=fixture("rejected");const m=await modules(f);const r=receipt();await invoke(m.data,"DELETE",deletionBody(r));const before=JSON.stringify(f.tables.account_deletion_audits[0]);
  f.state.authUser=other;expect((await invoke(m.data,"DELETE",deletionBody(r))).code).toBe(409);expect(JSON.stringify(f.tables.account_deletion_audits[0])).toBe(before);
  f.state.authUser=owner;expect((await invoke(m.data,"DELETE",deletionBody({...r,secret:receipt().secret}))).code).toBe(409);
  f.tables.account_deletion_audits[0].status="completed";f.tables.account_deletion_audits[0].completed_at=new Date().toISOString();expect((await invoke(m.data,"DELETE",deletionBody(r))).code).toBe(409);expect(f.tables.account_deletion_audits[0].status).toBe("completed");
});
test("cap猜测/过期/错误主体/服务异常均unknown；方法与格式限制保持",async()=>{
  const f=fixture();const m=await modules(f);const r=receipt();await invoke(m.data,"DELETE",deletionBody(r));
  for(const body of [{...r,subjectUserId:other},{...r,subjectUserId:owner,secret:receipt().secret},{...receipt(),subjectUserId:owner}])expect((await invoke(m.status,"POST",body)).body).toEqual({state:"unknown"});
  f.tables.account_deletion_audits[0].deletion_summary.receipt.expiresAt=new Date(Date.now()-1).toISOString();expect((await invoke(m.status,"POST",{...r,subjectUserId:owner})).body.state).toBe("unknown");
  expect((await invoke(m.status,"GET")).code).toBe(405);expect((await invoke(m.status,"POST",{...r,secret:"bad",subjectUserId:owner})).code).toBe(400);
});
test("迟到后置清理只触旧快照ID/版本，同邮箱新账号引用保留",async()=>{
  const f=fixture();const oldTime="2026-01-01T00:00:00Z";
  f.tables.school_invites=[{id:"old-invite",email,created_at:oldTime,updated_at:oldTime}];
  f.tables.user_permissions=[{id:"old-grant",owner_user_id:"grantor",grantee_email:email,permission_type:"guardian_view",status:"active",created_at:oldTime,revoked_at:null}];
  f.tables.admin_roles=[];
  f.state.afterDelete=()=>{f.tables.school_invites.push({id:"new-invite",email,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});f.tables.user_permissions.push({id:"new-grant",grantee_email:email,created_at:new Date().toISOString()});};
  const m=await modules(f);expect((await invoke(m.data,"DELETE",deletionBody(receipt()))).body.deleted).toBe(true);
  expect(f.tables.school_invites.map(r=>r.id)).toEqual(["new-invite"]);expect(f.tables.user_permissions.map(r=>r.id)).toEqual(["new-grant"]);
  const deletes=f.state.mutations.filter(q=>q.kind==="delete"&&["school_invites","user_permissions","admin_roles"].includes(q.table));expect(deletes.every(q=>q.filters.some(([op,key])=>op==="eq"&&key==="id"))).toBe(true);
});
test("公开cap入口复用实际HMAC IP预算，429和限额存储故障不读取账号",async()=>{
  for(const mode of ["deny","error"]){
    const f=fixture();f.state.rateMode=mode;const m=await modules(f);const r=receipt();const result=await invoke(m.status,"POST",{...r,subjectUserId:owner});
    expect(result.code).toBe(mode==="deny"?429:503);expect(result.body.state).toBe("unknown");expect(f.state.lookups).toBe(0);expect(f.state.mutations).toEqual([]);
    expect(f.state.rateCalls[0]).toMatchObject({p_action:"account_delete_status_ip",p_limit:30,p_window_seconds:60});expect(f.state.rateCalls[0].p_identifier_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(f.state.rateCalls)).not.toContain(r.secret);
    if(mode==="deny")expect(Number(result.headers["Retry-After"])).toBeGreaterThan(0);
  }
});
test("审计查询实际2秒abort超时归unknown，不挂起或误报未删",async()=>{
  const f=fixture();const m=await modules(f);const r=receipt();await invoke(m.data,"DELETE",deletionBody(r));f.state.auditHang=true;
  const start=Date.now();const result=await invoke(m.status,"POST",{...r,subjectUserId:owner});expect(result.body).toEqual({state:"unknown"});expect(Date.now()-start).toBeLessThan(4000);expect(f.state.lookups).toBe(0);
});
test("无本人认证/未确认/格式错/active管理员均不开始注销",async()=>{
  for(const condition of ["anonymous","confirmation","invalid","admin"]){
    const f=fixture();const m=await modules(f);const r=receipt();let body=deletionBody(r);
    if(condition==="anonymous")f.state.authUser=null;
    if(condition==="confirmation")body={...body,acknowledge:false};
    if(condition==="invalid")body={...body,receipt:{...r,secret:"bad"}};
    if(condition==="admin")f.tables.admin_roles=[{id:"admin",email,status:"active"}];
    const result=await invoke(m.data,"DELETE",body);expect(result.code).toBe(condition==="anonymous"?401:condition==="admin"?409:400);expect(f.state.deleteCalls).toBe(0);expect(f.tables.account_deletion_audits).toEqual([]);
  }
});
test("仅显式限时server客户端终止底层网络，默认导出/删除客户端不变",async()=>{
  const source=await readFile(path.join(process.cwd(),"lib/supabaseServer.ts"),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as Row};let observed:AbortSignal|undefined;
  vm.runInNewContext(output,{module,exports:module.exports,Buffer,Request,AbortSignal,
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:56321",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key"}},
    require:(name:string)=>{expect(name).toBe("@supabase/supabase-js");return{createClient:(_url:string,_key:string,options:Row)=>options};},
    fetch:(_input:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{observed=init.signal??undefined;observed?.addEventListener("abort",()=>reject(new Error("expected_abort")),{once:true});}),
  });
  expect(module.exports.getSupabaseAdmin().global).toBeUndefined();
  const client=module.exports.getSupabaseAdmin({requestTimeoutMs:25});const start=Date.now();
  await expect(client.global.fetch("http://127.0.0.1:56321/auth/v1/admin/users/synthetic")).rejects.toThrow("expected_abort");
  expect(observed?.aborted).toBe(true);expect(Date.now()-start).toBeLessThan(1000);
});

function sdkTransport(f: ReturnType<typeof fixture>, failDeleteId?: string) {
  const requests: Array<{table:string;method:string;params:URLSearchParams}> = [];
  let activeDeletes=0,maxDeletes=0;
  const fetchTransport: typeof fetch = async (input,init) => {
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);expect(url.origin).toBe("http://127.0.0.1:56321");
    const method=init?.method??"GET";const headers=new Headers(init?.headers);
    const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
    if(url.pathname.startsWith("/auth/v1/admin/users/")){
      if(method==="DELETE"){f.state.deleteCalls++;f.state.present=false;f.state.afterDelete();return respond({id:owner});}
      return f.state.present?respond({id:owner}):respond({code:"user_not_found",message:"User not found"},404);
    }
    const table=url.pathname.split("/").at(-1)!;const params=url.searchParams;requests.push({table,method,params:new URLSearchParams(params)});
    f.tables[table]??=[];
    const field=(row:Row,key:string)=>key.split(/->>?/).reduce((v:any,k)=>v?.[k],row);
    const selected=f.tables[table].filter(row=>[...params].every(([key,condition])=>{
      if(["select","order","offset","limit"].includes(key))return true;
      const dot=condition.indexOf(".");const op=condition.slice(0,dot),value=condition.slice(dot+1),actual=field(row,key);
      if(op==="eq")return String(actual)===value;if(op==="neq")return String(actual)!==value;
      if(op==="gt")return actual>value;if(op==="lte")return actual<=value;
      if(op==="is")return value==="null"?actual===null:String(actual)===value;
      if(op==="in")return value.slice(1,-1).split(",").includes(String(actual));
      throw new Error(`Unsupported transport filter ${op}`);
    }));
    if(method==="POST"){
      const item=JSON.parse(String(init?.body));const row={id:randomUUID(),...item};f.tables[table].push(row);return respond(headers.get("accept")?.includes("object")?row:[row],201);
    }
    if(method==="PATCH"){
      const patch=JSON.parse(String(init?.body));selected.forEach(row=>Object.assign(row,patch));return respond(headers.get("accept")?.includes("object")?selected[0]??null:selected);
    }
    if(method==="DELETE"){
      activeDeletes++;maxDeletes=Math.max(maxDeletes,activeDeletes);await new Promise(resolve=>setTimeout(resolve,0));activeDeletes--;
      if(selected.some(row=>row.id===failDeleteId))return respond({code:"synthetic_failure",message:sensitive},500);
      f.tables[table]=f.tables[table].filter(row=>!selected.includes(row));return respond([]);
    }
    const order=(params.get("order")??"").split(",").filter(Boolean).map(part=>part.split("."));
    if(selected.length&&order.some(([key])=>!(key in selected[0])))return respond({code:"42703",message:sensitive},400);
    selected.sort((a,b)=>{for(const [key,direction]of order){const cmp=String(field(a,key)).localeCompare(String(field(b,key)));if(cmp)return direction==="desc"?-cmp:cmp;}return 0;});
    const offset=Number(params.get("offset")??0),limit=Math.min(1000,Number(params.get("limit")??1000));
    const page=selected.slice(offset,offset+limit);
    return respond(headers.get("accept")?.includes("object")?page[0]??null:page);
  };
  f.admin=createClient("http://127.0.0.1:56321","synthetic-service-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchTransport}});
  return {requests,maxDeletes:()=>maxDeletes};
}
const pagedId=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`;
test("实际SDK传输上限1000时导出1001行及复合键/关联分页不截断或跨owner",async()=>{
  const f=fixture();f.tables.profiles[0].role="学生";const at="2010-01-01T00:00:00Z";
  f.tables.sweet_records=Array.from({length:1001},(_,i)=>({id:pagedId(i+1),user_id:owner,created_at:at,records:[],summary:"SYNTHETIC"}));
  f.tables.sweet_records.push({id:pagedId(9999),user_id:other,created_at:at,records:[],summary:"OTHER_OWNER_PRIVATE"});
  f.tables.community_blocks=Array.from({length:1001},(_,i)=>({blocker_user_id:owner,blocked_user_id:pagedId(i+1),created_at:at}));
  f.tables.support_cases=Array.from({length:1001},(_,i)=>({id:pagedId(i+1),student_user_id:owner,created_at:at}));
  f.tables.support_case_events=Array.from({length:1001},(_,i)=>({id:pagedId(i+1),case_id:pagedId(i+1),action:"created",previous_status:null,next_status:"requested",note:null,created_at:at}));
  f.tables.support_case_feedback=Array.from({length:1001},(_,i)=>({case_id:pagedId(i+1),felt_heard:true}));
  const transport=sdkTransport(f);const m=await modules(f);const result=await invoke(m.data,"GET");
  expect(result.code).toBe(200);expect(result.body.data.sweetRecords).toHaveLength(1001);expect(result.body.data.communityBlocks).toHaveLength(1001);expect(result.body.data.supportCases).toHaveLength(1001);expect(result.body.data.supportCaseEvents).toHaveLength(1001);expect(result.body.data.supportCaseFeedback).toHaveLength(1001);
  expect(JSON.stringify(result.body)).not.toContain("OTHER_OWNER_PRIVATE");
  const pages=transport.requests.filter(q=>q.table==="sweet_records");expect(pages.map(q=>q.params.get("offset"))).toEqual(["0","500","1000"]);expect(pages.every(q=>q.params.get("user_id")===`eq.${owner}`&&q.params.get("order")?.endsWith("id.asc"))).toBe(true);
  expect(transport.requests.filter(q=>q.table==="support_case_feedback").every(q=>(q.params.get("case_id")??"").split(",").length<=100)).toBe(true);
});
for(const fail of [false,true])test(`实际SDK 1001旧引用keyset与20并发清理${fail?"失败保留待办":"全量完成"}`,async()=>{
  const f=fixture();const at="2010-01-01T00:00:00Z";
  f.tables.school_invites=Array.from({length:1001},(_,i)=>({id:pagedId(i+1),email,created_at:at,updated_at:at}));
  f.tables.user_permissions=Array.from({length:1001},(_,i)=>({id:pagedId(i+1),owner_user_id:other,grantee_email:email,permission_type:"guardian_view",status:"active",created_at:at,revoked_at:null}));
  f.state.afterDelete=()=>{f.tables.school_invites.push({id:pagedId(2000),email,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});f.tables.school_invites[0].updated_at="2099-01-01T00:00:00Z";};
  const transport=sdkTransport(f,fail?pagedId(801):undefined);const m=await modules(f);const result=await invoke(m.data,"DELETE",deletionBody(receipt()));
  expect(result.code).toBe(200);expect(result.body).toEqual(fail?{deleted:true,cleanupPending:true}:{deleted:true});
  expect(f.tables.school_invites.map(r=>r.id).sort()).toEqual((fail?[pagedId(1),pagedId(801),pagedId(2000)]:[pagedId(1),pagedId(2000)]).sort());expect(f.tables.user_permissions).toHaveLength(fail?1:0);
  expect(f.tables.account_deletion_audits[0].status).toBe(fail?"cleanup_required":"completed");
  const pages=transport.requests.filter(q=>q.table==="school_invites"&&q.method==="GET"&&q.params.has("created_at"));expect(pages).toHaveLength(3);expect(pages.map(q=>q.params.get("id"))).toEqual([null,`gt.${pagedId(500)}`,`gt.${pagedId(1000)}`]);expect(pages.every(q=>q.params.get("order")==="id.asc"&&q.params.get("limit")==="500")).toBe(true);
  expect(transport.maxDeletes()).toBeLessThanOrEqual(20);
});
