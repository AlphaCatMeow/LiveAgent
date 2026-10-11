import assert from "node:assert/strict";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

test("AI approval settings persist backend modes and recover from failed saves", async () => {
 const env = await createDomTestEnv({ mocks: {
  "@liveagent/ui/i18n": { useLocale: () => ({ locale: "zh-CN" }) },
  "@liveagent/ui/components/ui/button": { Button: ({children,...props}) => env.React.createElement("button",props,children) },
 }});
 const { AIApprovalSection } = env.loadModule("@liveagent/ui/pages/settings/AIApprovalSection.tsx");
 let value={mode:"kbrain",models:[{provider:"p",id:"small"}],providers:[],aiApproval:{mode:"off"}};
 let fail=false;
 const updates=[];
 const kbrain={getConnection:()=>({baseUrl:"http://fixture",token:""}),getSettings:async()=>value, updateSettings:async(update)=>{updates.push(update);if(fail)throw Error("save failed");value={...value,...update};return value;}};
 const host=document.body.appendChild(document.createElement("div"));const root=env.createRoot(host);
 const click=async(el)=>env.act(async()=>{el.click();await Promise.resolve();});
 try {
  await env.act(async()=>root.render(env.React.createElement(AIApprovalSection,{kbrain})));
  assert.equal(host.querySelectorAll('input[type="radio"]').length,3);
  await click(host.querySelector('[value="auto"]'));
  assert.equal(host.querySelector("fieldset button").disabled,true);
  const select=host.querySelector("select");
  await env.act(async()=>{select.value=JSON.stringify(["p","small"]);select.dispatchEvent(new window.Event("change",{bubbles:true}));});
  for(const mode of ["risk_only","auto","off"]){
   await click(host.querySelector(`[value="${mode}"]`));await click(host.querySelector("fieldset button"));
   assert.equal(updates.at(-1).aiApproval.mode,mode);assert.equal(host.querySelector('[role="status"]').textContent,"已保存");
  }
  fail=true;await click(host.querySelector("fieldset button"));assert.match(host.querySelector('[role="alert"]').textContent,/save failed/);
  fail=false;await click(host.querySelector("fieldset button"));assert.equal(host.querySelector('[role="alert"]'),null);
  value={...value,aiApproval:undefined};await click([...host.querySelectorAll("button")].find(b=>b.textContent==="重新加载"));
  assert.match(host.querySelector('[role="alert"]').textContent,/升级/);
 }finally{await env.act(async()=>root.unmount());host.remove();env.cleanup();}
});
