var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var SHEET_ID = "1nGR8PcQxIgIRbxAyxBoPC5YmDRjy7Nk_p9k51MnKe8k";
var GID = "0";
var CACHE_SECONDS = 300;
var COL = {
  name: 2,
  company: 3,
  weapon: 4,
  skills: 5,
  // 5~16: 빌드업 4단계 × (1스킬, 2스킬, 버스트)
  overload: 17,
  // 17~19: 오버로드 우선순위 1~3
  extra: 20,
  cube: 21,
  usage: 22,
  coll: 23,
  favPriority: 24
};
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") return handleData(request, ctx, url.searchParams.has("fresh"));
    if (url.pathname === "/api/img") return handleImage(request, ctx, url.searchParams.get("u") || "");
    return env.ASSETS.fetch(request);
  }
};
async function handleData(request, ctx, fresh) {
  const cache = caches.default;
  const key = new Request(new URL("/api/data", request.url).toString());
  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  try {
    const data = await buildData();
    const res = new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${CACHE_SECONDS}`
      }
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
__name(handleData, "handleData");
var IMG_PREFIX = "https://docs.google.com/sheets-images-rt/";
async function handleImage(request, ctx, src) {
  if (!src.startsWith(IMG_PREFIX)) return new Response("bad image url", { status: 400 });
  const cache = caches.default;
  const key = new Request(new URL("/api/img?u=" + encodeURIComponent(src), request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const upstream = await fetchWithRetry(src);
  if (!upstream) return new Response("image fetch failed", { status: 502, headers: { "cache-control": "no-store" } });
  const res = new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/png",
      "cache-control": "public, max-age=86400"
    }
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
__name(handleImage, "handleImage");
async function fetchWithRetry(src, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(src, { headers: { "user-agent": "Mozilla/5.0 nikke.nebula.kim" } });
      if (res.ok) return res;
    } catch {
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 300));
  }
  return null;
}
__name(fetchWithRetry, "fetchWithRetry");
async function buildData(fetchText = defaultFetchText) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const [gviz, html] = await Promise.all([
    fetchText(`${base}/gviz/tq?tqx=out:json&headers=0&gid=${GID}`),
    fetchText(`${base}/htmlview/sheet?headers=false&gid=${GID}`).catch(() => "")
  ]);
  return parse(gviz, html);
}
__name(buildData, "buildData");
async function defaultFetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 nikke.nebula.kim" } });
  if (!res.ok) throw new Error(`\uC2DC\uD2B8 \uC694\uCCAD \uC2E4\uD328 (${res.status})`);
  return res.text();
}
__name(defaultFetchText, "defaultFetchText");
function parse(gvizText, htmlText) {
  const json = JSON.parse(gvizText.slice(gvizText.indexOf("{"), gvizText.lastIndexOf("}") + 1));
  if (json.status === "error") throw new Error(json.errors?.[0]?.detailed_message || "\uC2DC\uD2B8 \uC624\uB958");
  const rows = json.table.rows.map((r) => (r.c || []).map((c) => (c && c.v != null ? String(c.f ?? c.v) : "").trim()));
  const images = parseImages(htmlText);
  const intro = [];
  const list = [];
  for (const r of rows) {
    const name = r[COL.name] || "";
    if (name && r[COL.company] && name !== "\uCE90\uB9AD\uD130\uBA85") {
      list.push(toNikke(r, images));
    } else if (!list.length && name && name !== "\uCE90\uB9AD\uD130\uBA85") {
      intro.push(name);
    } else {
      const note = r.find((v) => v.startsWith("\u203B"));
      if (note && list.length) list[list.length - 1].footnotes.push(note);
    }
  }
  return { updated: (/* @__PURE__ */ new Date()).toISOString(), intro, list };
}
__name(parse, "parse");
var lines = /* @__PURE__ */ __name((s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean), "lines");
var normName = /* @__PURE__ */ __name((s) => s.replace(/[\s:：()（）]/g, ""), "normName");
function toNikke(r, images) {
  const nameLines = lines(r[COL.name]);
  const full = nameLines.join(" ").replace(/\s*:\s*/g, " : ").replace(/\s+/g, " ").trim();
  const [main, ...rest] = full.split(" : ");
  const skills = [];
  for (let s = 0; s < 4; s++) {
    skills.push([0, 1, 2].map((k) => r[COL.skills + s * 3 + k] || ""));
  }
  const coll = lines(r[COL.coll]);
  const favPriority = r[COL.favPriority] || "";
  const usage = lines(r[COL.usage]);
  return {
    name: main,
    sub: rest.join(" : "),
    image: images.get(normName(full)) || "",
    company: r[COL.company],
    weapon: r[COL.weapon].replace("\uB7F0\uCCD0", "\uB7F0\uCC98"),
    skills,
    overload: [0, 1, 2].map((k) => lines(r[COL.overload + k])).filter((l) => l.length),
    extra: lines(r[COL.extra]),
    cube: lines(r[COL.cube]),
    modes: usage.filter((u) => /^PV[EP]$/.test(u)),
    usage: usage.filter((u) => !/^PV[EP]$/.test(u)),
    coll,
    favorite: Boolean(favPriority) || coll.some((c) => /단계/.test(c)),
    favPriority,
    footnotes: []
  };
}
__name(toNikke, "toNikke");
function parseImages(html) {
  const map = /* @__PURE__ */ new Map();
  if (!html) return map;
  for (const row of html.split(/<tr[\s>]/).slice(1)) {
    const cells = row.split(/<td[\s>]/).slice(1);
    cells.forEach((cell, i) => {
      const m = cell.match(/<img[^>]+src="(https:\/\/docs\.google\.com\/sheets-images-rt\/[^"]+)"/);
      if (!m || !cells[i + 1]) return;
      const name = decode(cells[i + 1].replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/^[^>]*>/, ""));
      if (name) map.set(normName(name), "/api/img?u=" + encodeURIComponent(decode(m[1]).replace(/=[^/=]*$/, "")));
    });
  }
  return map;
}
__name(parseImages, "parseImages");
function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}
__name(decode, "decode");

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8Nd2OL/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8Nd2OL/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  buildData,
  middleware_loader_entry_default as default,
  parse
};
//# sourceMappingURL=worker.js.map
