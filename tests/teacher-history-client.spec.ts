import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { openTeacher, controlTeacher, teacherState } from "./fixtures/teacher-history-local-browser";
const A="00000000-0000-4000-8000-000000000011",B="00000000-0000-4000-8000-000000000012";
const copyFor=(locale:"zh-CN"|"en")=>locale==="en"?en:zh;
async function visibleBody(page:Page,owner="A"){await expect(page.locator("article")).toContainText(`${owner} PRIVATE BODY`);}
async function statusCount(page:Page){return (await teacherState(page)).calls.filter(c=>c.path==="/api/account/status").length;}
async function pending(page:Page,kind:string){await expect.poll(async()=>(await teacherState(page)).pending.some(p=>p.kind===kind)).toBe(true);}
async function verify(page:Page,locale:"zh-CN"|"en"){await page.getByRole("button",{name:copyFor(locale).messages.actions.revalidate,exact:true}).click();}
async function noEscape(page:Page,fixture:{network:string[];errors:string[]}){expect(fixture.network).toEqual([]);expect(fixture.errors).toEqual([]);const state=await teacherState(page);expect(state.unexpected).toEqual([]);expect(state.calls.every(c=>c.method==="GET")).toBe(true);}
async function shot(page:Page,name:string,project:string){const target=process.env.YOUTHTEMPO_TEACHER_SCREENSHOTS_DIR||"audit-records/2026-11-04/product01_teacher_history_implementation/screenshots";await mkdir(target,{recursive:true});await page.screenshot({path:`${target}/${project}-${name}.png`,fullPage:true});}
async function accountExportButton(page:Page,locale:"zh-CN"|"en"){
 const copy=copyFor(locale);await expect(page.getByRole("heading",{name:/Synthetic Teacher A/})).toBeVisible();
 const details=page.locator("details").filter({has:page.locator("summary",{hasText:copy.account.settings.title})});
 if(!(await details.getAttribute("open")))await details.locator("summary").click();
 await page.getByRole("button",{name:copy.account.settings.data,exact:true}).click();
 return page.getByRole("button",{name:copy.account.dataExport.action,exact:true});
}
for(const locale of ["zh-CN","en"] as const){
 test(`visual ${locale} messages actual component anonymous body and failed revalidation clears old text`,async({page},info)=>{
  const fixture=await openTeacher(page,{locale});await visibleBody(page);
  await expect(page.locator("article")).toContainText(copyFor(locale).messages.lists.senderAnonymous);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  await shot(page,`${locale}-messages-current`,info.project.name);
  const before=await statusCount(page);await controlTeacher(page,"set","readFailure",503);await verify(page,locale);
  await expect(page.locator("article")).toHaveCount(0);await expect(page.locator("main")).not.toContainText("A PRIVATE BODY");
  await shot(page,`${locale}-messages-failed-hidden`,info.project.name);
  await controlTeacher(page,"set","readFailure",0);await verify(page,locale);await visibleBody(page);
  expect(await statusCount(page)).toBe(before);await noEscape(page,fixture);
 });
 test(`UI ${locale} stable focus visibility manual chains use only identity and GET without status or writes`,async({page})=>{
  const fixture=await openTeacher(page,{locale});await visibleBody(page);const statuses=await statusCount(page);
  await controlTeacher(page,"focus");await visibleBody(page);
  await controlTeacher(page,"visibility","hidden");await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"visibility","visible");await visibleBody(page);await verify(page,locale);await visibleBody(page);
  expect(await statusCount(page)).toBe(statuses);await noEscape(page,fixture);
 });
 test(`UI ${locale} late old read cannot restore body after newer failure or ABA`,async({page})=>{
  const fixture=await openTeacher(page,{locale});await visibleBody(page);
  await controlTeacher(page,"set","holdRead",true);await verify(page,locale);await pending(page,"read");await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"set","holdRead",false);await controlTeacher(page,"set","readFailure",503);await verify(page,locale);await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"release","read");await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"set","readFailure",0);await verify(page,locale);await visibleBody(page);
  await controlTeacher(page,"set","holdRead",true);await verify(page,locale);await pending(page,"read");
  await controlTeacher(page,"set","holdRead",false);await controlTeacher(page,"actor",B);await visibleBody(page,"B");await controlTeacher(page,"actor",A);await visibleBody(page);
  await controlTeacher(page,"set","empty",true);await verify(page,locale);await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"release","read");await expect(page.locator("article")).toHaveCount(0);await noEscape(page,fixture);
 });
 test(`UI ${locale} signout retires pending message and identity establishment initializes metadata`,async({page})=>{
  const fixture=await openTeacher(page,{locale});await visibleBody(page);const before=await statusCount(page);
  await controlTeacher(page,"set","holdRead",true);await verify(page,locale);await pending(page,"read");
  await controlTeacher(page,"actor","");await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"release","read");await expect(page.locator("article")).toHaveCount(0);
  await controlTeacher(page,"set","holdRead",false);await controlTeacher(page,"actor",A);await visibleBody(page);
  expect(await statusCount(page)).toBeGreaterThan(before);await noEscape(page,fixture);
 });
 test(`visual ${locale} actual account export works once and URL anchor are cleared`,async({page},info)=>{
  const fixture=await openTeacher(page,{locale,route:"account"});const button=await accountExportButton(page,locale);await button.click();
  await expect.poll(async()=>(await teacherState(page)).clicks.length).toBe(1);const state=await teacherState(page);
  expect(state.created).toEqual(state.revoked);expect(state.removed).toHaveLength(1);expect(state.clicks[0].download).toBe("Synthetic-export.json");
  await expect(page.locator("main")).toContainText(copyFor(locale).account.notices.exportStarted);
  expect(await page.locator("a[download]").count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot(page,`${locale}-account-export-confirmed`,info.project.name);await noEscape(page,fixture);
 });
 test(`visual ${locale} account pending export retired by focus and a fresh explicit export remains separate`,async({page},info)=>{
  const fixture=await openTeacher(page,{locale,route:"account"});const button=await accountExportButton(page,locale);
  await controlTeacher(page,"set","holdBlob",true);await button.click();await pending(page,"blob");
  await controlTeacher(page,"focus");await expect(button).toBeEnabled();await controlTeacher(page,"release","blob");
  let state=await teacherState(page);expect(state.created).toHaveLength(0);expect(state.clicks).toHaveLength(0);expect(state.calls.filter(c=>c.path==="/api/account/data")).toHaveLength(1);
  await expect(page.locator("main")).not.toContainText(copyFor(locale).account.notices.exportStarted);
  await shot(page,`${locale}-account-export-retired`,info.project.name);
  await controlTeacher(page,"set","holdBlob",false);await button.click();await expect.poll(async()=>(await teacherState(page)).clicks.length).toBe(1);
  state=await teacherState(page);expect(state.calls.filter(c=>c.path==="/api/account/data")).toHaveLength(2);expect(state.created).toEqual(state.revoked);await noEscape(page,fixture);
 });
}

test("metadata preguard old getUser pending then newer metadata starts: old cannot call account/status",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",holdUser:true});await pending(page,"user");expect(await statusCount(page)).toBe(0);
 await controlTeacher(page,"set","holdUser",false);await controlTeacher(page,"consent",true);await visibleBody(page);
 const current=await statusCount(page);expect(current).toBe(1);
 await controlTeacher(page,"release","user");await expect.poll(async()=>(await teacherState(page)).pending.length).toBe(0);
 expect(await statusCount(page)).toBe(current);await visibleBody(page);await noEscape(page,fixture);
});
test("metadata initialization survives readEpoch retirement by focus",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",holdMetadata:true,role:"学生"});await pending(page,"metadata");
 await controlTeacher(page,"focus");await visibleBody(page);expect(await statusCount(page)).toBe(1);
 await expect(page.locator("form textarea")).toHaveCount(0);
 await controlTeacher(page,"release","metadata");await expect(page.locator("form textarea")).toBeVisible();
 expect(await statusCount(page)).toBe(1);await verify(page,"en");await visibleBody(page);await noEscape(page,fixture);
});
test("metadata postguard old status cannot replace newer metadata",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",holdMetadata:true});await pending(page,"metadata");
 await controlTeacher(page,"set","holdMetadata",false);await controlTeacher(page,"set","role","学生");await controlTeacher(page,"consent",true);
 await expect(page.locator("form textarea")).toBeVisible();await controlTeacher(page,"release","metadata");
 await expect(page.locator("form textarea")).toBeVisible();expect(await statusCount(page)).toBe(2);await noEscape(page,fixture);
});

test("actual inline consent hook retains original focus/status initialization side effect; scoped page read claim is separate",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",actualConsent:true});await visibleBody(page);const before=await statusCount(page);
 await controlTeacher(page,"focus");await visibleBody(page);await expect.poll(()=>statusCount(page)).toBeGreaterThan(before);
 await noEscape(page,fixture);
});
for(const retirement of ["hidden","signout","ABA","unmount"] as const){
 test(`account export ${retirement} retires held download without implicit retry`,async({page})=>{
  const fixture=await openTeacher(page,{locale:"en",route:"account"});const button=await accountExportButton(page,"en");
  await controlTeacher(page,"set","holdBlob",true);await button.click();await pending(page,"blob");
  if(retirement==="hidden")await controlTeacher(page,"visibility","hidden");
  if(retirement==="signout")await controlTeacher(page,"actor","");
  if(retirement==="ABA"){await controlTeacher(page,"actor",B);await expect(page.getByRole("heading",{name:/Synthetic Teacher B/})).toBeVisible();await controlTeacher(page,"actor",A);await expect(page.getByRole("heading",{name:/Synthetic Teacher A/})).toBeVisible();}
  if(retirement==="unmount")await controlTeacher(page,"unmount");
  await controlTeacher(page,"release","blob");const state=await teacherState(page);
  expect(state.created).toHaveLength(0);expect(state.clicks).toHaveLength(0);expect(state.calls.filter(c=>c.path==="/api/account/data")).toHaveLength(1);await noEscape(page,fixture);
 });
}
for(const scenario of ["normal","stale-before-token","stale-after-blob","retire-after-create","click-throws"] as const){
 test(`actual cloudRecords export ${scenario} cleans URL and anchor and fences obsolete result`,async({page})=>{
  const fixture=await openTeacher(page,{locale:"en",route:"helper"});
  if(scenario==="stale-before-token")await controlTeacher(page,"set","current",false);
  if(scenario==="stale-after-blob")await controlTeacher(page,"set","holdBlob",true);
  if(scenario==="retire-after-create")await controlTeacher(page,"set","retireOnCreate",true);
  if(scenario==="click-throws")await controlTeacher(page,"set","throwClick",true);
  await controlTeacher(page,"startDownload");
  if(scenario==="stale-after-blob"){await pending(page,"blob");await controlTeacher(page,"set","current",false);await controlTeacher(page,"release","blob");}
  await expect.poll(async()=>(await teacherState(page)).completed.length).toBe(1);const state=await teacherState(page);
  expect(state.created).toEqual(state.revoked);expect(await page.locator("a[download]").count()).toBe(0);
  expect(state.clicks).toHaveLength(["normal","click-throws"].includes(scenario)?1:0);
  if(scenario==="stale-before-token"){expect(state.calls).toHaveLength(0);expect(state.authCalls).toHaveLength(0);}
  if(scenario==="click-throws"){expect(state.removed).toHaveLength(1);expect(state.completed[0]).toContain("error:");}
  await noEscape(page,fixture);
 });
}

test("UI malformed messages 200 and failed identity each clear prior body; manual restoration does not call status",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en"});await visibleBody(page);const before=await statusCount(page);
 await controlTeacher(page,"set","malformed",true);await verify(page,"en");await expect(page.locator("article")).toHaveCount(0);
 await controlTeacher(page,"set","malformed",false);await verify(page,"en");await visibleBody(page);
 await controlTeacher(page,"set","userFailure",true);await verify(page,"en");await expect(page.locator("article")).toHaveCount(0);
 await controlTeacher(page,"set","userFailure",false);await verify(page,"en");await visibleBody(page);
 expect(await statusCount(page)).toBe(before);await noEscape(page,fixture);
});
test("account old retired export cannot complete or clear a newer pending export; synchronous duplicates send once",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",route:"account"});const button=await accountExportButton(page,"en");
 await controlTeacher(page,"set","holdBlob",true);await button.evaluate((node:HTMLButtonElement)=>{const key=Object.keys(node).find(k=>k.startsWith("__reactProps$"));if(!key)throw new Error("Actual event unavailable");const props=(node as unknown as Record<string,{onClick?:()=>unknown}>)[key];if(!props.onClick)throw new Error("Actual click unavailable");props.onClick();props.onClick();});
 await pending(page,"blob");expect((await teacherState(page)).calls.filter(c=>c.path==="/api/account/data")).toHaveLength(1);
 await controlTeacher(page,"focus");await expect(button).toBeEnabled();await button.click();
 await expect.poll(async()=>(await teacherState(page)).pending.filter(p=>p.kind==="blob").length).toBe(2);
 await controlTeacher(page,"release","blob",true);await expect(page.getByText(en.account.dataExport.title,{exact:true}).locator("..").getByRole("button")).toBeDisabled();expect((await teacherState(page)).clicks).toHaveLength(0);
 await controlTeacher(page,"release","blob");await expect.poll(async()=>(await teacherState(page)).clicks.length).toBe(1);
 expect((await teacherState(page)).calls.filter(c=>c.path==="/api/account/data")).toHaveLength(2);await noEscape(page,fixture);
});
test("account confirmActor rejects session mismatch before export request and private download",async({page})=>{
 const fixture=await openTeacher(page,{locale:"en",route:"account"});const button=await accountExportButton(page,"en");
 await controlTeacher(page,"sessionError",true);await button.click();
 await expect(page.getByRole("heading",{name:/Synthetic Teacher A/})).toHaveCount(0);
 const state=await teacherState(page);expect(state.calls.filter(c=>c.path==="/api/account/data")).toHaveLength(0);expect(state.created).toHaveLength(0);await noEscape(page,fixture);
});
