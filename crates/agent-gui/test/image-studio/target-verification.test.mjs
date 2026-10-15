import assert from "node:assert/strict";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

test("verification panel requires consent, freezes double clicks, and queries without regeneration", async () => {
  const env = await createDomTestEnv();
  const { ImageTargetVerification } = env.loadModule("@liveagent/ui/pages/settings/ImageTargetVerification");
  const container = document.createElement("div");
  const root = env.createRoot(container);
  let submits = 0, queries = 0, refreshed = 0, enabled = 0;
  let resolve;
  const receipt = { id: "iv_test", targetId: "it_test", state: "pending", settingsRevision: 1 };
  const client = {
    listProjects: async () => ({ items: [{ id: "ip_test", title: "测试项目" }] }),
    startTargetVerification: async (_target, input, key) => {
      submits++; assert.equal(input.confirmPaid, true); assert.equal(input.count, 1); assert.ok(key);
      return new Promise(r => { resolve = r; });
    },
    getTargetVerification: async () => { queries++; return { ...receipt, state: "verified" }; },
  };
  const target = { id: "it_test", connectionId: "ic_test", remoteId: "gpt-image-2", adapter: "openai-images", adapterVersion: "1", kind: "model", revision: 1, enabled: false, parameters: [], capabilities: { operations: ["generate"], maxCount: 1, maxInputs: 0, outputFormats: ["png"] } };
  const button = label => [...container.querySelectorAll("button")].find(b => b.textContent === label);
  try {
    await env.act(async () => root.render(env.React.createElement(ImageTargetVerification, { client, target, revision: 1, disabled: false, onVerified: () => refreshed++, onEnable: () => enabled++ })));
    assert.equal(button("提交验证").disabled, true);
    await env.act(async () => button("载入设计项目").click());
    assert.equal(button("提交验证").disabled, true);
    await env.act(async () => container.querySelector('input[type="checkbox"]').click());
    assert.equal(button("提交验证").disabled, false);
    await env.act(async () => { button("提交验证").click(); button("提交验证").click(); });
    assert.equal(submits, 1);
    await env.act(async () => resolve(receipt));
    await env.act(async () => button("查询收据（不重新生成）").click());
    assert.equal(queries, 1); assert.equal(submits, 1); assert.equal(refreshed, 1); assert.equal(enabled, 0);
    await env.act(async () => button("启用目标（保存后生效）").click());
    assert.equal(enabled, 1);
  } finally { await env.act(async () => root.unmount()); env.cleanup(); }
});

test("lost verification response can be recovered by GET without resubmitting", async () => {
  const env = await createDomTestEnv();
  const { ImageTargetVerification } = env.loadModule("@liveagent/ui/pages/settings/ImageTargetVerification");
  const container = document.createElement("div"); const root = env.createRoot(container);
  let submits = 0, queries = 0, key;
  const client = {
    listProjects: async () => ({items:[{id:"ip_test",title:"项目"}]}),
    startTargetVerification: async (_id,_input,k) => { submits++; key=k; throw new Error("network"); },
    getTargetVerificationByKey: async (_id,k) => { queries++; assert.equal(k,key); return {id:"iv_found",targetId:"it_test",state:"pending",settingsRevision:1}; },
  };
  const target = {id:"it_test",connectionId:"ic_test",remoteId:"gpt-image-2",adapter:"openai-images",adapterVersion:"1",kind:"model",revision:1,parameters:[],capabilities:{operations:["generate"],maxCount:1,maxInputs:0,outputFormats:["png"]}};
  const button = label => [...container.querySelectorAll("button")].find(b=>b.textContent===label);
  try {
    await env.act(async()=>root.render(env.React.createElement(ImageTargetVerification,{client,target,revision:1,disabled:false,onVerified(){},onEnable(){}})));
    await env.act(async()=>button("载入设计项目").click());
    await env.act(async()=>container.querySelector('input[type="checkbox"]').click());
    await env.act(async()=>button("提交验证").click());
    assert.equal(submits,1);
    assert.equal(button("查询收据（不重新生成）").disabled,false);
    await env.act(async()=>button("查询收据（不重新生成）").click());
    assert.equal(submits,1); assert.equal(queries,1);
    assert.match(container.querySelector('[role="status"]').textContent,/iv_found/);
  } finally {await env.act(async()=>root.unmount());env.cleanup();}
});
test("recreated verification panel restores a journaled request and never submits on mount", async()=>{
  const env=await createDomTestEnv();const {ImageTargetVerification}=env.loadModule("@liveagent/ui/pages/settings/ImageTargetVerification");
  const container=document.createElement("div");const root=env.createRoot(container);let submits=0,queries=0;
  const target={id:"it_test",connectionId:"ic_test",remoteId:"gpt-image-2",adapter:"openai-images",adapterVersion:"1",kind:"model",revision:1,parameters:[],capabilities:{operations:["generate"],maxCount:1,maxInputs:0,outputFormats:["png"]}};
  const client={hasVerificationPersistence:()=>true,loadVerificationAttempt:()=>({key:"stored-key",input:{projectId:"ip_test",prompt:"原始提示词"}}),startTargetVerification:async()=>{submits++;throw Error("must not submit");},getTargetVerificationByKey:async(_id,key)=>{queries++;assert.equal(key,"stored-key");return{id:"iv_restore",targetId:"it_test",state:"pending",settingsRevision:1};}};
  try {
    await env.act(async()=>root.render(env.React.createElement(ImageTargetVerification,{client,target,revision:1,disabled:false,onVerified(){},onEnable(){}})));
    assert.equal(submits,0);assert.equal(container.querySelector('[aria-label="验证提示词"]').value,"原始提示词");
    const query=[...container.querySelectorAll("button")].find(b=>b.textContent==="查询收据（不重新生成）");assert.equal(query.disabled,false);
    await env.act(async()=>query.click());assert.equal(queries,1);assert.equal(submits,0);assert.match(container.querySelector('[role="status"]').textContent,/iv_restore/);
  } finally {await env.act(async()=>root.unmount());env.cleanup();}
});
test("Google verification panel accepts only the reviewed minimal model and still requires consent",async()=>{
  const env=await createDomTestEnv();const {ImageTargetVerification}=env.loadModule("@liveagent/ui/pages/settings/ImageTargetVerification");
  const container=document.createElement("div");const root=env.createRoot(container);let submits=0;
  const client={listProjects:async()=>({items:[{id:"ip_test",title:"项目"}]}),startTargetVerification:async(id,input)=>{submits++;assert.equal(input.remoteId,"gemini-nano-banana-2.1");assert.equal(input.confirmPaid,true);return{id:"iv_google",targetId:id,state:"pending",settingsRevision:1};}};
  const target={id:"it_google",connectionId:"ic_test",remoteId:"gemini-nano-banana-2.1",adapter:"google-generate-content-image",adapterVersion:"1",kind:"model",revision:1,parameters:[],capabilities:{operations:["generate"],maxCount:1,maxInputs:0,outputFormats:["png"]}};
  const button=label=>[...container.querySelectorAll("button")].find(b=>b.textContent===label);
  try {
    await env.act(async()=>root.render(env.React.createElement(ImageTargetVerification,{key:"reviewed",client,target,revision:1,disabled:false,onVerified(){},onEnable(){}})));
    await env.act(async()=>button("载入设计项目").click());assert.equal(button("提交验证").disabled,true);
    await env.act(async()=>container.querySelector('input[type="checkbox"]').click());assert.equal(button("提交验证").disabled,false);
    await env.act(async()=>button("提交验证").click());assert.equal(submits,1);
    await env.act(async()=>root.render(env.React.createElement(ImageTargetVerification,{key:"unsupported",client:{...client},target:{...target,id:"it_other",remoteId:"unknown-model"},revision:1,disabled:false,onVerified(){},onEnable(){}})));
    await env.act(async()=>button("载入设计项目").click());await env.act(async()=>container.querySelector('input[type="checkbox"]').click());
    assert.equal(button("提交验证").disabled,true);assert.equal(submits,1);
  }finally{await env.act(async()=>root.unmount());env.cleanup();}
});