import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DEFAULT_SETTINGS} from "../src/shared/defaults";
import {createProvider} from "../src/background/providers";
vi.mock("../src/background/providers",()=>({createProvider:vi.fn()}));
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const settings={...DEFAULT_SETTINGS,cacheEnabled:false,concurrency:1};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();});
afterEach(()=>vi.unstubAllGlobals());
describe("video priority and cancellation through the shared translation service",()=>{
 it("keeps subtitle FIFO priority above explicit translation and iframe page prefetch",async()=>{
  let release!:(value:string[])=>void;
  const translate=vi.fn().mockImplementationOnce(()=>new Promise<string[]>(resolve=>{release=resolve;}))
    .mockImplementation(async request=>request.texts.map((text:string)=>"译:"+text));
  vi.mocked(createProvider).mockReturnValue({id:"test",label:"test",validateConfig:()=>({ok:true}),translateBatch:translate});
  const {translateWithSettings}=await import("../src/background/translation");
  const first=translateWithSettings(settings,{texts:["running"],targetLang:"zh-CN"});await flush();
  const page=translateWithSettings(settings,{texts:["prefetch"],targetLang:"zh-CN",pageSession:{id:"session",documentKey:"frame"}});
  const manual=translateWithSettings(settings,{texts:["manual"],targetLang:"zh-CN"});
  const live1=translateWithSettings(settings,{texts:["live-1"],targetLang:"zh-CN"},{priority:true});
  const live2=translateWithSettings(settings,{texts:["live-2"],targetLang:"zh-CN"},{priority:true});await flush();
  expect(translate).toHaveBeenCalledTimes(1);release(["完成"]);
  await Promise.all([first,page,manual,live1,live2]);
  expect(translate.mock.calls.map(([request])=>request.texts[0])).toEqual(["running","live-1","live-2","manual","prefetch"]);
 });
 it("removes a cancelled queued subtitle and never sends it to the provider",async()=>{
  let release!:(value:string[])=>void;
  const translate=vi.fn().mockImplementationOnce(()=>new Promise<string[]>(resolve=>{release=resolve;})).mockResolvedValue(["后续"]);
  vi.mocked(createProvider).mockReturnValue({id:"test",label:"test",validateConfig:()=>({ok:true}),translateBatch:translate});
  const {translateWithSettings}=await import("../src/background/translation");
  const first=translateWithSettings(settings,{texts:["first"],targetLang:"zh-CN"});await flush();
  const controller=new AbortController();
  const queued=translateWithSettings(settings,{texts:["cancel me"],targetLang:"zh-CN"},{signal:controller.signal,priority:true});
  const cancelled=expect(queued).rejects.toMatchObject({name:"AbortError"});await flush();controller.abort();await cancelled;
  const following=translateWithSettings(settings,{texts:["following"],targetLang:"zh-CN"});
  release(["第一"]);await first;await following;
  expect(translate.mock.calls.map(([request])=>request.texts[0])).toEqual(["first","following"]);
 });
 it("runs a queued live subtitle before queued page work without exceeding concurrency",async()=>{
  let release!:(value:string[])=>void;
  const translate=vi.fn().mockImplementationOnce(()=>new Promise<string[]>(resolve=>{release=resolve;})).mockImplementation(async request=>request.texts.map((text:string)=>"译:"+text));
  vi.mocked(createProvider).mockReturnValue({id:"test",label:"test",validateConfig:()=>({ok:true}),translateBatch:translate});
  const {translateWithSettings}=await import("../src/background/translation");
  const first=translateWithSettings(settings,{texts:["first"],targetLang:"zh-CN"});await flush();
  const page=translateWithSettings(settings,{texts:["page"],targetLang:"zh-CN"});await flush();
  const live=translateWithSettings(settings,{texts:["live"],targetLang:"zh-CN"},{priority:true});await flush();
  expect(translate).toHaveBeenCalledTimes(1);release(["第一"]);await Promise.all([first,page,live]);
  expect(translate.mock.calls.map(([request])=>request.texts[0])).toEqual(["first","live","page"]);
 });
 it("cancels an active subtitle through the provider signal and keeps subtitles out of persistent cache",async()=>{
  const get=vi.fn(),set=vi.fn();
  vi.stubGlobal("chrome",{storage:{local:{get,set}}});
  const controller=new AbortController();
  const translate=vi.fn().mockImplementationOnce((_request,signal:AbortSignal)=>new Promise<string[]>((_resolve,reject)=>{
   signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
  })).mockResolvedValue(["后续"]);
  vi.mocked(createProvider).mockReturnValue({id:"google-web-translate",label:"Google 翻译",validateConfig:()=>({ok:true}),translateBatch:translate});
  const cachedSettings={...settings,cacheEnabled:true};
  const {translateWithSettings}=await import("../src/background/translation");
  const task=translateWithSettings(cachedSettings,{texts:["live"],sourceLang:"en",targetLang:"zh-CN"},
   {signal:controller.signal,priority:true,persistentCache:false});
  const cancelled=expect(task).rejects.toMatchObject({name:"AbortError"});
  await flush();expect(translate).toHaveBeenCalledTimes(1);
  const providerSignal=translate.mock.calls[0][1] as AbortSignal;
  controller.abort();await cancelled;
  expect(providerSignal.aborted).toBe(true);
  await expect(translateWithSettings(cachedSettings,{texts:["following"],sourceLang:"en",targetLang:"zh-CN"},
   {persistentCache:false})).resolves.toEqual({translations:["后续"],cached:0});
  expect(get).not.toHaveBeenCalled();expect(set).not.toHaveBeenCalled();
 });
});
