import { test } from "node:test";
import assert from "node:assert/strict";
import { advancePublisher } from "./publishers.mjs";

const account = { platform:"instagram", provider_id:"ig-123", connection_kind:"instagram_login" };
const mk = (status, id) => new Response(JSON.stringify(status ? {status_code:status} : {id}), {
  status:200, headers:{"content-type":"application/json"},
});

test("Story images use STORIES container without feed caption", async () => {
  const calls = [];
  const mock = async (url, opts={}) => {
    calls.push({url:String(url), body:JSON.parse(opts.body)});
    return mk(null, "story-container");
  };
  const result = await advancePublisher({
    env:{},account,token:"test",media:{mime:"image/jpeg"}, post:{post_kind:"story",title:"X",caption:"Should not be story caption"},
    options:{},state:{},mediaURL:"https://media.example/story.jpg",fetcher:mock,
  });
  assert.equal(result.state.phase,"container");
  assert.deepEqual(calls[0].body,{media_type:"STORIES",image_url:"https://media.example/story.jpg"});
});

test("carousel checkpoints every child before submitting exactly one parent", async () => {
  const calls = [];
  let childCount=0;
  const mock = async (url, opts={}) => {
    const path=String(url);
    if (path.includes("fields=status_code")) return mk("FINISHED");
    const body=JSON.parse(opts.body);
    calls.push(body);
    if (body.is_carousel_item) return mk(null,"child-"+(++childCount));
    if (body.media_type==="CAROUSEL") return mk(null,"parent");
    if (path.endsWith("/media_publish")) return mk(null,"post-123");
    throw new Error("Unexpected provider write");
  };
  const assets=[{mime:"image/jpeg"},{mime:"video/mp4"}],post={post_kind:"carousel",title:"Comic",caption:"Punchline"};
  let state={},result;
  const run=async () => {
    result=await advancePublisher({
      env:{},account,token:"test",media:assets[0],mediaList:assets,post,options:{},state,
      mediaURL: !state.phase || state.phase==="carousel-child" ? "https://media.example/"+(state.index||0) : null,
      fetcher:mock,
    });
    state=result.state;return result;
  };
  await run();assert.equal(state.phase,"carousel-check");assert.deepEqual(state.children,["child-1"]);
  await run();assert.equal(state.phase,"carousel-child");assert.equal(state.index,1);
  await run();assert.equal(state.phase,"carousel-check");assert.deepEqual(state.children,["child-1","child-2"]);
  await run();assert.equal(state.phase,"carousel-parent");
  await run();assert.equal(state.phase,"container");assert.equal(state.container_id,"parent");
  await run();assert.equal(state.phase,"finish");
  await run();assert.equal(result.status,"published");assert.equal(result.providerId,"post-123");
  assert.equal(childCount,2);
  assert.equal(calls.filter(x=>x.media_type==="CAROUSEL").length,1);
  assert.deepEqual(calls.find(x=>x.media_type==="CAROUSEL").children,["child-1","child-2"]);
  assert.equal(calls[0].is_carousel_item,true);
  assert.equal(calls[1].media_type,"VIDEO");
});
