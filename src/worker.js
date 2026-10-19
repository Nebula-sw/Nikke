// nikke.nebula.kim — 정적 페이지(public/) + 시트 데이터 API(/api/data)
//
// 시트를 바꾸려면 아래 SHEET_ID / GID만 수정하면 됩니다.
const SHEET_ID = "1nGR8PcQxIgIRbxAyxBoPC5YmDRjy7Nk_p9k51MnKe8k";
const GID = "0"; // "육성표" 탭
const CACHE_SECONDS = 300;

// 육성표 열 위치 (0부터, A열 = 0)
const COL = {
  name: 2, company: 3, weapon: 4,
  skills: 5,      // 5~16: 빌드업 4단계 × (1스킬, 2스킬, 버스트)
  overload: 17,   // 17~19: 오버로드 우선순위 1~3
  extra: 20, cube: 21, usage: 22, coll: 23, favPriority: 24,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") return handleData(request, ctx, url.searchParams.has("fresh"));
    if (url.pathname === "/api/img") return handleImage(request, ctx, url.searchParams.get("u") || "");
    return env.ASSETS.fetch(request);
  },
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
        "cache-control": `public, max-age=${CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

// 시트 이미지는 다른 사이트에서 직접 띄울 수 없게 막혀 있어서(CORP: same-site) 여기서 대신 받아 전달
const IMG_PREFIX = "https://docs.google.com/sheets-images-rt/";

async function handleImage(request, ctx, src) {
  if (!src.startsWith(IMG_PREFIX)) return new Response("bad image url", { status: 400 });
  const cache = caches.default;
  const key = new Request(request.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const upstream = await fetch(src);
  if (!upstream.ok) return new Response("image fetch failed", { status: 502 });
  const res = new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export async function buildData(fetchText = defaultFetchText) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const [gviz, html] = await Promise.all([
    fetchText(`${base}/gviz/tq?tqx=out:json&headers=0&gid=${GID}`),
    fetchText(`${base}/htmlview/sheet?headers=false&gid=${GID}`).catch(() => ""),
  ]);
  return parse(gviz, html);
}

async function defaultFetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 nikke.nebula.kim" } });
  if (!res.ok) throw new Error(`시트 요청 실패 (${res.status})`);
  return res.text();
}

export function parse(gvizText, htmlText) {
  const json = JSON.parse(gvizText.slice(gvizText.indexOf("{"), gvizText.lastIndexOf("}") + 1));
  if (json.status === "error") throw new Error(json.errors?.[0]?.detailed_message || "시트 오류");
  const rows = json.table.rows.map(r => (r.c || []).map(c => (c && c.v != null ? String(c.f ?? c.v) : "").trim()));
  const images = parseImages(htmlText);

  const intro = [];
  const list = [];
  for (const r of rows) {
    const name = r[COL.name] || "";
    if (name && r[COL.company] && name !== "캐릭터명") {
      list.push(toNikke(r, images));
    } else if (!list.length && name && name !== "캐릭터명") {
      intro.push(name);
    } else {
      // 표 중간의 "※ …" 안내 줄은 바로 위 니케의 메모로 붙임
      const note = r.find(v => v.startsWith("※"));
      if (note && list.length) list[list.length - 1].footnotes.push(note);
    }
  }
  return { updated: new Date().toISOString(), intro, list };
}

const lines = s => (s || "").split("\n").map(x => x.trim()).filter(Boolean);
const normName = s => s.replace(/[\s:：()（）]/g, "");

function toNikke(r, images) {
  const nameLines = lines(r[COL.name]);
  const full = nameLines.join(" ").replace(/\s*:\s*/g, " : ").replace(/\s+/g, " ").trim();
  const [main, ...rest] = full.split(" : ");

  const skills = [];
  for (let s = 0; s < 4; s++) {
    skills.push([0, 1, 2].map(k => r[COL.skills + s * 3 + k] || ""));
  }
  const coll = lines(r[COL.coll]);
  const favPriority = r[COL.favPriority] || "";
  const usage = lines(r[COL.usage]);

  return {
    name: main,
    sub: rest.join(" : "),
    image: images.get(normName(full)) || "",
    company: r[COL.company],
    weapon: r[COL.weapon].replace("런쳐", "런처"),
    skills,
    overload: [0, 1, 2].map(k => lines(r[COL.overload + k])).filter(l => l.length),
    extra: lines(r[COL.extra]),
    cube: lines(r[COL.cube]),
    modes: usage.filter(u => /^PV[EP]$/.test(u)),
    usage: usage.filter(u => !/^PV[EP]$/.test(u)),
    coll,
    favorite: Boolean(favPriority) || coll.some(c => /단계/.test(c)),
    favPriority,
    footnotes: [],
  };
}

// htmlview에서 이미지 셀 → 바로 오른쪽 셀(캐릭터명) 매핑
function parseImages(html) {
  const map = new Map();
  if (!html) return map;
  for (const row of html.split(/<tr[\s>]/).slice(1)) {
    const cells = row.split(/<td[\s>]/).slice(1);
    cells.forEach((cell, i) => {
      const m = cell.match(/<img[^>]+src="(https:\/\/docs\.google\.com\/sheets-images-rt\/[^"]+)"/);
      if (!m || !cells[i + 1]) return;
      const name = decode(cells[i + 1].replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/^[^>]*>/, ""));
      // 크기 지정(=w112-h104)을 떼면 원본(128px)으로 받음
      if (name) map.set(normName(name), "/api/img?u=" + encodeURIComponent(decode(m[1]).replace(/=[^/=]*$/, "")));
    });
  }
  return map;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}
