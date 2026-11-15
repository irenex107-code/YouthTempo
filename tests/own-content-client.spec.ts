import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { controlOwn, openOwnContent, ownState } from "./fixtures/own-content-local-browser";

const A="00000000-0000-4000-8000-000000000011", B="00000000-0000-4000-8000-000000000012";
type Locale="zh-CN"|"en";
type Kind="communityPosts"|"communityComments"|"peerSpaceMessages"|"peerSpaceControls";
const copyFor=(locale:Locale)=>locale==="en"?en:zh;
const ownCopy=(locale:Locale)=>(copyFor(locale).account as unknown as {ownContent:Record<string,string>}).ownContent;
const panel=(page:Page,locale:Locale)=>page.getByRole("region",{name:ownCopy(locale).title,exact:true});
const reads=async(page:Page)=>(await ownState(page)).calls.filter(c=>c.path==="/api/account/data");
const deletes=async(page:Page)=>(await ownState(page)).calls.filter(c=>c.method==="DELETE");
async function pending(page:Page,kind:string){await expect.poll(async()=>(await ownState(page)).pending.some(p=>p.kind===kind)).toBe(true);}
async function openSettings(page:Page,locale:Locale){
 const details=page.locator("details").filter({has:page.locator("summary",{hasText:copyFor(locale).account.settings.title})});
 await expect(details).toBeVisible();
 if(!(await details.getAttribute("open")))await details.locator("summary").click();
 await details.getByRole("button",{name:copyFor(locale).account.settings.data,exact:true}).click();
 await expect(panel(page,locale)).toBeVisible();
}
async function read(page:Page,locale:Locale){await panel(page,locale).getByRole("button",{name:ownCopy(locale).read,exact:true}).click();}
async function body(page:Page,locale:Locale,owner="A"){await expect(panel(page,locale)).toContainText(`${owner} OWN POST BODY`);await expect(panel(page,locale)).toContainText(`${owner} OWN PEER BODY`);}
function group(page:Page,locale:Locale,kind:Kind){return panel(page,locale).getByRole("heading",{level:4}).filter({hasText:ownCopy(locale)[kind]}).locator("..");}
async function choose(page:Page,locale:Locale,kind:Kind){
 await group(page,locale,kind).getByRole("button",{name:ownCopy(locale)[kind==="peerSpaceControls"?"removeControl":"removeContent"],exact:true}).click();
 await expect(panel(page,locale).getByRole("group",{name:ownCopy(locale).confirmAction,exact:true})).toBeVisible();
}
async function confirm(page:Page,locale:Locale){await panel(page,locale).getByRole("group",{name:ownCopy(locale).confirmAction,exact:true}).getByRole("button",{name:ownCopy(locale).confirmAction,exact:true}).click();}
async function checked(page:Page,locale:Locale,key:string){await expect(panel(page,locale)).toContainText(ownCopy(locale)[key]);}
async function operationConfirmation(page:Page,locale:Locale){
 const status=panel(page,locale).getByRole("status").filter({hasText:ownCopy(locale).operationResult});
 await expect(status).toContainText(ownCopy(locale).confirmed);
 await expect(status).toContainText(ownCopy(locale).peerSpaceMessages);
}
async function noEscape(page:Page,fixture:{network:string[];errors:string[]}){
 expect(fixture.network).toEqual([]);expect(fixture.errors).toEqual([]);
 const state=await ownState(page);expect(state.unexpected).toEqual([]);expect(state.created).toEqual([]);expect(state.revoked).toEqual([]);expect(state.downloads).toEqual([]);
 expect(state.calls.filter(c=>c.method!=="GET"&&c.method!=="DELETE")).toEqual([]);
 expect(state.calls.filter(c=>c.path.startsWith("/api/community/")&&c.method==="GET")).toEqual([]);
 expect(state.calls.filter(c=>c.path.startsWith("/api/peer-space/")&&c.method==="GET")).toEqual([]);
 expect(state.calls.filter(c=>c.path==="/api/account/data"||c.method==="DELETE").every(c=>c.cache==="no-store")).toBe(true);
}
async function shot(page:Page,locale:Locale,name:string,project:string){
 const card=await panel(page,locale).boundingBox();
 const button=await panel(page,locale).getByRole("button",{name:ownCopy(locale).read,exact:true}).boundingBox();
 expect(card).not.toBeNull();expect(button).not.toBeNull();
 expect(button!.x).toBeGreaterThanOrEqual(card!.x);
 expect(button!.x+button!.width).toBeLessThanOrEqual(card!.x+card!.width+1);
 const target=process.env.YOUTHTEMPO_OWN_SCREENSHOTS_DIR||"audit-records/2026-11-04/product01_own_content_implementation/screenshots";
 await mkdir(target,{recursive:true});await page.screenshot({path:`${target}/${project}-${locale}-${name}.png`,fullPage:true});
}
async function doubleClickActual(button:Locator){
 await button.evaluate((node:HTMLButtonElement)=>{const key=Object.keys(node).find(k=>k.startsWith("__reactProps$"));if(!key)throw new Error("Actual React event unavailable");const props=(node as unknown as Record<string,{onClick?:()=>unknown}>)[key];if(!props.onClick)throw new Error("Actual click missing");props.onClick();props.onClick();});
}

for(const locale of["zh-CN","en"]as const){
 test(`visual ${locale} withdrawn actual account reads four own arrays without flow or full export persistence`,async({page},info)=>{
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);
  expect(await reads(page)).toHaveLength(0);await read(page,locale);await body(page,locale);
  for(const kind of["communityPosts","communityComments","peerSpaceMessages","peerSpaceControls"]as const)await expect(group(page,locale,kind).locator("li")).toHaveCount(1);
  await expect(panel(page,locale)).not.toContainText("UNRELATED PRIVATE EXPORT DATA");
  await expect(panel(page,locale)).toContainText(ownCopy(locale).retained);
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot(page,locale,"four-arrays",info.project.name);await noEscape(page,fixture);
 });
 test(`visual ${locale} inline confirmation is canceled and retired on focus before any DELETE`,async({page},info)=>{
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await read(page,locale);await body(page,locale);
  await choose(page,locale,"communityPosts");await shot(page,locale,"inline-confirmation",info.project.name);
  await panel(page,locale).getByRole("button",{name:ownCopy(locale).cancel,exact:true}).click();expect(await deletes(page)).toHaveLength(0);
  await choose(page,locale,"communityPosts");await controlOwn(page,"focus");
  await expect(panel(page,locale).getByRole("group")).toHaveCount(0);await expect(panel(page,locale)).not.toContainText("A OWN POST BODY");expect(await deletes(page)).toHaveLength(0);
  await read(page,locale);await body(page,locale);await noEscape(page,fixture);
 });
 test(`visual ${locale} peer confirmation survives verified failed contradictory and verified reads`,async({page},info)=>{
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await read(page,locale);await body(page,locale);
  await choose(page,locale,"peerSpaceMessages");await confirm(page,locale);await operationConfirmation(page,locale);
  expect(await deletes(page)).toHaveLength(1);expect(await reads(page)).toHaveLength(1);
  await expect(panel(page,locale)).not.toContainText("A OWN PEER BODY");
  await read(page,locale);await checked(page,locale,"verified");await operationConfirmation(page,locale);
  await controlOwn(page,"set","readFailure",503);await read(page,locale);await checked(page,locale,"readFailed");await operationConfirmation(page,locale);
  await expect(panel(page,locale)).not.toContainText("A OWN PEER BODY");
  await shot(page,locale,"confirmed-read-failed",info.project.name);
  await controlOwn(page,"set","readFailure",0);await controlOwn(page,"set","contradictoryRead",true);await read(page,locale);await checked(page,locale,"unconfirmed");await checked(page,locale,"snapshotDiff");await operationConfirmation(page,locale);
  await shot(page,locale,"confirmed-snapshot-diff",info.project.name);
  await controlOwn(page,"set","contradictoryRead",false);await read(page,locale);await checked(page,locale,"verified");await operationConfirmation(page,locale);
  expect(await deletes(page)).toHaveLength(1);await shot(page,locale,"confirmed-verified",info.project.name);await noEscape(page,fixture);
 });
 test(`visual ${locale} consent lookup failure and absent nickname do not block own management`,async({page},info)=>{
  const fixture=await openOwnContent(page,{locale,consentError:true,noName:true});await openSettings(page,locale);await read(page,locale);await body(page,locale);
  expect((await ownState(page)).calls.filter(c=>c.path==="/api/account/consent")).toHaveLength(1);
  await shot(page,locale,"consent-error-no-name",info.project.name);await noEscape(page,fixture);
 });
 for(const kind of["communityPosts","communityComments","peerSpaceControls"]as const){
  test(`UI ${locale} ${kind} retains endpoint contract and requires explicit GET to verify`,async({page})=>{
   const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await read(page,locale);await body(page,locale);
   await choose(page,locale,kind);await confirm(page,locale);await checked(page,locale,kind==="peerSpaceControls"?"confirmed":"acknowledged");
   expect(await reads(page)).toHaveLength(1);expect(await deletes(page)).toHaveLength(1);
   await read(page,locale);await checked(page,locale,"verified");
   if(kind==="peerSpaceControls")await expect(group(page,locale,kind).locator("li")).toHaveCount(0);
   else{await expect(group(page,locale,kind)).toContainText(ownCopy(locale).removed);await expect(group(page,locale,kind).getByRole("button",{name:ownCopy(locale).removeContent,exact:true})).toHaveCount(0);}
   const call=(await deletes(page))[0];expect(call.body?.locale).toBe(locale);
   const contract={communityPosts:["/api/community/posts","postId"],communityComments:["/api/community/comments","commentId"],peerSpaceControls:["/api/peer-space/controls","controlId"]}[kind];
   expect(call.path).toBe(contract[0]);expect(Object.keys(call.body||{}).sort()).toEqual(["locale",contract[1]].sort());
   await noEscape(page,fixture);
  });
 }
 test(`UI ${locale} explicit rejection clears private list without implicit delete retry`,async({page})=>{
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await read(page,locale);await body(page,locale);
  await controlOwn(page,"set","deleteFailure",403);await choose(page,locale,"communityPosts");await confirm(page,locale);await checked(page,locale,"denied");
  await expect(panel(page,locale)).not.toContainText("A OWN POST BODY");expect(await deletes(page)).toHaveLength(1);expect(await reads(page)).toHaveLength(1);
  await read(page,locale);await body(page,locale);expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
 });
 test(`UI ${locale} unknown committed DELETE needs manual read and keeps original unknown source`,async({page})=>{
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await read(page,locale);await body(page,locale);
  await controlOwn(page,"set","networkDelete",true);await choose(page,locale,"peerSpaceMessages");await confirm(page,locale);await checked(page,locale,"unknown");
  expect(await deletes(page)).toHaveLength(1);expect(await reads(page)).toHaveLength(1);
  await read(page,locale);await checked(page,locale,"verified");await checked(page,locale,"unknown");expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
 });
}

for(const retirement of["focus","hidden","signout","ABA","unknown-identity","unmount"]as const){
 test(`UI held old GET ${retirement} never restores private arrays and never implicitly reads`,async({page})=>{
  const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
  await controlOwn(page,"set","holdRead",true);await read(page,"en");await pending(page,"read");
  if(retirement==="focus")await controlOwn(page,"focus");
  if(retirement==="hidden")await controlOwn(page,"visibility","hidden");
  if(retirement==="signout")await controlOwn(page,"actor","");
  if(retirement==="ABA"){await controlOwn(page,"actor",B);await expect(page.getByRole("heading",{name:"Hello, Synthetic Account B",exact:true})).toBeVisible();await controlOwn(page,"actor",A);await expect(page.getByRole("heading",{name:"Hello, Synthetic Account A",exact:true})).toBeVisible();await openSettings(page,"en");}
  if(retirement==="unknown-identity"){await controlOwn(page,"set","userFailure",true);await controlOwn(page,"actor",B);await expect(page.getByRole("heading",{name:"Hello, Synthetic Account A",exact:true})).toHaveCount(0);}
  if(retirement==="unmount")await controlOwn(page,"unmount");
  await controlOwn(page,"set","holdRead",false);await controlOwn(page,"release","read");
  await expect(page.locator("#root")).not.toContainText("A OWN POST BODY");expect(await reads(page)).toHaveLength(2);expect(await deletes(page)).toHaveLength(0);await noEscape(page,fixture);
 });
}

test("UI held old token cannot dispatch DELETE under a switched or ABA account",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await choose(page,"en","communityPosts");await controlOwn(page,"set","holdNextSession",true);await confirm(page,"en");await pending(page,"session");
 await controlOwn(page,"actor",B);await expect(page.getByRole("heading",{name:"Hello, Synthetic Account B",exact:true})).toBeVisible();
 await controlOwn(page,"actor",A);await expect(page.getByRole("heading",{name:"Hello, Synthetic Account A",exact:true})).toBeVisible();
 await controlOwn(page,"release","session");expect(await deletes(page)).toHaveLength(0);await expect(page.locator("main")).not.toContainText("A OWN POST BODY");await noEscape(page,fixture);
});

test("UI held JSON timeout is unknown read and late parse cannot restore arrays",async({page})=>{
 await page.clock.install();const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");
 await controlOwn(page,"set","holdJson",true);await read(page,"en");await pending(page,"json");await page.clock.fastForward(10_100);
 await checked(page,"en","readFailed");await controlOwn(page,"release","json");await expect(panel(page,"en")).not.toContainText("A OWN POST BODY");expect(await reads(page)).toHaveLength(1);await noEscape(page,fixture);
});

test("UI pending DELETE timeout preserves unknown and late response never triggers retry",async({page})=>{
 await page.clock.install();const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await controlOwn(page,"set","holdDelete",true);await choose(page,"en","peerSpaceMessages");await confirm(page,"en");await pending(page,"delete");await page.clock.fastForward(10_100);
 await checked(page,"en","unknown");expect(await deletes(page)).toHaveLength(1);await controlOwn(page,"release","delete");
 await read(page,"en");await checked(page,"en","verified");await checked(page,"en","unknown");expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
});

test("UI synchronous double confirmation sends one DELETE until manual fresh read",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await controlOwn(page,"set","holdDelete",true);await choose(page,"en","peerSpaceMessages");
 const button=panel(page,"en").getByRole("group",{name:ownCopy("en").confirmAction,exact:true}).getByRole("button",{name:ownCopy("en").confirmAction,exact:true});
 await doubleClickActual(button);await pending(page,"delete");expect(await deletes(page)).toHaveLength(1);
 await expect(panel(page,"en").getByRole("button",{name:copyFor("en").account.actions.processing,exact:true})).toBeDisabled();
 await controlOwn(page,"release","delete");await operationConfirmation(page,"en");expect(await reads(page)).toHaveLength(1);await noEscape(page,fixture);
});

for(const malformed of["missing","row","owner"]as const){
 test(`UI malformed account 200 ${malformed} clears prior content and is never treated as empty`,async({page})=>{
  const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
  await controlOwn(page,"set","malformedRead",malformed);await read(page,"en");await checked(page,"en","readFailed");
  await expect(panel(page,"en")).not.toContainText("A OWN POST BODY");await expect(panel(page,"en")).not.toContainText(ownCopy("en").empty);await noEscape(page,fixture);
 });
}

test("UI community zero-row acknowledgement is not deletion proof and never auto retries",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await controlOwn(page,"set","commitDelete",false);await choose(page,"en","communityPosts");await confirm(page,"en");await checked(page,"en","acknowledged");
 await read(page,"en");await checked(page,"en","unconfirmed");await checked(page,"en","acknowledged");await body(page,"en");expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
});

test("UI malformed DELETE 200 has unknown outcome despite potential commit",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await controlOwn(page,"set","malformedDelete",true);await choose(page,"en","peerSpaceMessages");await confirm(page,"en");await checked(page,"en","unknown");
 await read(page,"en");await checked(page,"en","verified");await checked(page,"en","unknown");expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
});


test("UI failed session read clears prior content without issuing a management request",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await controlOwn(page,"sessionError",true);await read(page,"en");await checked(page,"en","readFailed");
 await expect(panel(page,"en")).not.toContainText("A OWN POST BODY");expect(await reads(page)).toHaveLength(1);expect(await deletes(page)).toHaveLength(0);
 await controlOwn(page,"sessionError",false);await read(page,"en");await body(page,"en");expect(await reads(page)).toHaveLength(2);await noEscape(page,fixture);
});

test("UI held JSON focus retirement clears private rows and allows only explicit fresh GET",async({page})=>{
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await controlOwn(page,"set","holdJson",true);await read(page,"en");await pending(page,"json");
 await controlOwn(page,"focus");await controlOwn(page,"release","json");await expect(panel(page,"en")).not.toContainText("A OWN POST BODY");expect(await reads(page)).toHaveLength(1);
 await controlOwn(page,"set","holdJson",false);await read(page,"en");await body(page,"en");expect(await reads(page)).toHaveLength(2);await noEscape(page,fixture);
});


for (const invalidDate of ["", "not-a-date"]) {
 test(`UI confirmed peer then invalid deleted_at ${JSON.stringify(invalidDate)} fails complete read without losing original confirmation`, async ({page}, info) => {
  const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
  await choose(page,"en","peerSpaceMessages");await confirm(page,"en");await operationConfirmation(page,"en");
  await read(page,"en");await checked(page,"en","verified");
  await controlOwn(page,"set","deletedAtOverride",invalidDate);await read(page,"en");await checked(page,"en","readFailed");await operationConfirmation(page,"en");
  await expect(panel(page,"en")).not.toContainText("A OWN PEER BODY");await expect(panel(page,"en")).not.toContainText(ownCopy("en").verified);
  await expect(panel(page,"en")).not.toContainText(ownCopy("en").empty);expect(await deletes(page)).toHaveLength(1);
  await shot(page,"en",invalidDate ? "confirmed-invalid-date" : "confirmed-empty-date",info.project.name);await noEscape(page,fixture);
 });
}

test("UI personal control confirmation survives ID reappearing and later failed or verified reads", async ({page}, info) => {
 const fixture=await openOwnContent(page,{locale:"en"});await openSettings(page,"en");await read(page,"en");await body(page,"en");
 await choose(page,"en","peerSpaceControls");await confirm(page,"en");await checked(page,"en","confirmed");
 const source=panel(page,"en").getByRole("status").filter({hasText:ownCopy("en").operationResult});await expect(source).toContainText(ownCopy("en").peerSpaceControls);
 await read(page,"en");await checked(page,"en","verified");await checked(page,"en","confirmed");
 await controlOwn(page,"set","contradictoryRead",true);await read(page,"en");await checked(page,"en","snapshotDiff");await checked(page,"en","confirmed");
 await shot(page,"en","control-confirmed-snapshot-diff",info.project.name);
 await controlOwn(page,"set","readFailure",503);await read(page,"en");await checked(page,"en","readFailed");await checked(page,"en","confirmed");
 await controlOwn(page,"set","readFailure",0);await controlOwn(page,"set","contradictoryRead",false);await read(page,"en");await checked(page,"en","verified");await checked(page,"en","confirmed");
 expect(await deletes(page)).toHaveLength(1);await noEscape(page,fixture);
});


for (const locale of ["zh-CN", "en"] as const) {
 test(`visual ${locale} empty then long records remain manageable with keyboard and pagination`, async ({page}, info) => {
  const fixture=await openOwnContent(page,{locale});await openSettings(page,locale);await controlOwn(page,"set","empty",true);
  await panel(page,locale).getByRole("button",{name:ownCopy(locale).read,exact:true}).focus();await page.keyboard.press("Enter");
  await expect(panel(page,locale).getByText(ownCopy(locale).empty,{exact:true})).toHaveCount(4);
  await expect(panel(page,locale).getByRole("alert")).toHaveCount(0);await shot(page,locale,"genuine-empty",info.project.name);
  await controlOwn(page,"set","empty",false);await controlOwn(page,"set","manyPosts",true);await read(page,locale);
  await expect(group(page,locale,"communityPosts").locator("li")).toHaveCount(20);
  await group(page,locale,"communityPosts").getByRole("button",{name:ownCopy(locale).more,exact:true}).click();
  await expect(group(page,locale,"communityPosts").locator("li")).toHaveCount(21);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await noEscape(page,fixture);
 });
}
