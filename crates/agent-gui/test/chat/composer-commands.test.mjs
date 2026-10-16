import assert from "node:assert/strict";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";
const env = await createDomTestEnv();
const { buildComposerCommands, parseComposerCommandDraft, runComposerCommand, filterComposerCommands, loopIntervalToCron } = env.loadModule("@liveagent/ui/lib/chat/composerCommands.ts");
const catalog = [
  ...["goal", "loop", "plan", "model", "compact", "rewind"].map(name => ({name,kind:"action",source:"builtin",description:name})),
  {name:"init",kind:"prompt",source:"builtin",description:"init"},
  {name:"deploy",kind:"prompt",source:"user",description:"Deploy"},
];
function fixture() {
  const calls=[];
  const host={sendTurn:async (...args)=>calls.push(["send",...args]),clearGoal:()=>calls.push(["clear"]),enablePlanMode:()=>calls.push(["plan"]),openModelPicker:()=>calls.push(["picker"]),selectModel:name=>calls.push(["model",name]),compact:()=>calls.push(["compact"]),rewindLastTurn:()=>calls.push(["rewind"]),loops:{create:async(interval,prompt)=>({id:"loop-abc123",interval,prompt,enabled:true}),list:async()=>[],cancel:async id=>calls.push(["cancel",id])},recordCommandResult:async (...args)=>calls.push(["record",...args])};
  const skills=[{name:"reviewer",description:"Review",skillFile:"/skills/reviewer/SKILL.md",baseDir:"/skills/reviewer"}];
  const commands=buildComposerCommands({host,catalog,skills});
  const effects={host,t:key=>key,consumeDraft:()=>calls.push(["consume"]),showPanel:panel=>calls.push(["panel",panel])};
  return {host,calls,commands,async run(text){const parsed=parseComposerCommandDraft(text,commands);assert.ok(parsed);await runComposerCommand(parsed,effects);}};
}
test("desktop catalog gates unsupported actions and keeps skills",()=>{
 const f=fixture();assert.deepEqual(f.commands.map(c=>c.name),["goal","loop","plan","model","compact","rewind","init","deploy","reviewer"]);
 assert.equal(parseComposerCommandDraft("/new",f.commands),null);
 assert.equal(parseComposerCommandDraft("/usr/bin",f.commands),null);
 assert.deepEqual(filterComposerCommands(f.commands,"skill:rev",30).map(c=>c.name),["reviewer"]);
});
test("plan preserves command text and applies only one submission",async()=>{
 const f=fixture();await f.run("/plan write tests");assert.deepEqual(f.calls.at(-1),["send","/plan write tests",undefined,{planMode:true}]);
 f.calls.length=0;await f.run("/plan");assert.deepEqual(f.calls,[["consume"],["plan"]]);
});
test("goal dispatch preserves display text and structural goal",async()=>{
 const f=fixture();await f.run("/goal ship it");assert.deepEqual(f.calls.at(-1),["send","/goal ship it",{kind:"goal",action:"set",goal:"ship it"}]);
 await f.run("/goal resume");assert.deepEqual(f.calls.at(-1),["send","/goal resume",{kind:"goal",action:"resume"}]);
});
test("model without argument opens picker; name selects directly",async()=>{
 const f=fixture();await f.run("/model");assert.deepEqual(f.calls.at(-1),["picker"]);await f.run("/model Sonnet");assert.deepEqual(f.calls.at(-1),["model","Sonnet"]);
});
test("prompt commands are sent verbatim for backend expansion",async()=>{const f=fixture();await f.run('/deploy staging');assert.deepEqual(f.calls.at(-1),["send","/deploy staging",{kind:"prompt"}]);});
test("loop results go into conversation and invalid intervals do not mutate",async()=>{
 const f=fixture();await f.run("/loop 1m report time");assert.equal(f.calls.at(-1)[0],"record");assert.equal(f.calls.at(-1)[1],"/loop 1m report time");
 f.calls.length=0;await f.run("/loop 30s test");assert.equal(f.calls[0][0],"panel");assert.equal(f.calls[0][1].type,"error");
 assert.equal(loopIntervalToCron("10m"),"0 */10 * * * *");
});
test("builtins localize while author descriptions remain unchanged",()=>{
 const f=fixture();const list=buildComposerCommands({host:f.host,catalog,skills:[],t:key=>key==='chat.commands.builtin.goal.description'?'持续执行目标':key});assert.equal(list[0].description,'持续执行目标');assert.equal(list.at(-1).description,'Deploy');
});
test.after(()=>env.cleanup());