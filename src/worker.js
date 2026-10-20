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

// 시트 데이터: 5분이 지나도 저장해 둔 데이터를 "바로" 돌려주고, 새 데이터는 뒤에서 만들어 저장 (stale-while-revalidate)
// → 사이트를 열 때 시트를 읽느라 기다리는 일이 거의 없음. 저장본은 하루까지 씀
const STALE_SECONDS = 86400;
const DATA_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" };

async function handleData(request, ctx, fresh) {
  const cache = caches.default;
  const key = new Request(new URL("/api/data", request.url).toString());
  if (!fresh) {
    const hit = await cache.match(key);
    if (hit) {
      const builtAt = Number(hit.headers.get("x-built-at") || 0);
      // 5분 지났으면 뒤에서 새로 만들기 (지금 요청은 기다리지 않음)
      if (Date.now() - builtAt > CACHE_SECONDS * 1000) ctx.waitUntil(rebuildData(key).catch(() => {}));
      return new Response(hit.body, { headers: DATA_HEADERS });
    }
  }
  try {
    return new Response(await rebuildData(key), { headers: DATA_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

/** 시트를 읽어 JSON을 만들고 캐시에 저장 (만든 시각을 x-built-at에 적어 둠) */
async function rebuildData(key) {
  const body = JSON.stringify(await buildData());
  await caches.default.put(key, new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${STALE_SECONDS}`, "x-built-at": String(Date.now()) },
  }));
  return body;
}

// 시트 이미지는 다른 사이트에서 직접 띄울 수 없게 막혀 있어서(CORP: same-site) 여기서 대신 받아 전달
const IMG_PREFIX = "https://docs.google.com/sheets-images-rt/";

async function handleImage(request, ctx, src) {
  if (!src.startsWith(IMG_PREFIX)) return new Response("bad image url", { status: 400 });
  const cache = caches.default;
  // 캐시 이름은 원본 주소 기준 (화면이 재시도할 때 붙이는 &r=1 같은 값은 무시)
  const key = new Request(new URL("/api/img?u=" + encodeURIComponent(src), request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const upstream = await fetchWithRetry(src);
  // 실패 응답은 브라우저가 저장하지 않게 (다음에 다시 시도할 수 있도록)
  if (!upstream) return new Response("image fetch failed", { status: 502, headers: { "cache-control": "no-store" } });
  const res = new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/png",
      // 시트 이미지 주소는 그림마다 고유해서(그림이 바뀌면 주소도 바뀜) 1년 동안 다시 받을 필요 없음
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// 구글이 한꺼번에 들어오는 이미지 요청 일부를 잠깐 거절(429 등)할 때가 있어서, 조금씩 기다리며 최대 3번 시도
async function fetchWithRetry(src, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(src, { headers: { "user-agent": "Mozilla/5.0 nikke.nebula.kim" } });
      if (res.ok) return res;
    } catch {}
    if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * (i + 1) + Math.random() * 300));
  }
  return null;
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
  const elements = parseElements(htmlText);

  const intro = [];
  const list = [];
  for (const r of rows) {
    const name = r[COL.name] || "";
    if (name && r[COL.company] && name !== "캐릭터명") {
      list.push(toNikke(r, images, elements));
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

function toNikke(r, images, elements) {
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
    element: elements.get(normName(full)) || "", // 속성 (작열·수냉·풍압·전격·철갑). 못 찾으면 빈 값
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

// ── 속성 ──
// 시트에는 속성이 글자로 없고, 초상화 오른쪽 아래에 '떠 있는 아이콘 그림'으로만 붙어 있음.
// 그 그림은 직접 받아볼 수 없어서(구글이 막음), 그림 주소가 같은 것끼리 묶은 뒤
// 속성을 확실히 아는 기준 니케가 어느 묶음에 있는지로 각 묶음의 속성을 정함.
// (시트 주인이 아이콘을 바꿔 올려도 기준 니케만 있으면 자동으로 다시 맞춰짐)
const ELEMENT_ANCHORS = {
  "모더니아": "작열",
  "헬름": "수냉",
  "노아": "풍압",
  "엑시아": "전격",
  "레드후드": "철갑",
};

function parseElements(html) {
  const result = new Map();
  if (!html) return result;

  // 1) 니케마다 시작 행 번호 + 이름 (초상화 칸의 행 번호, 바로 오른쪽 칸이 이름)
  const starts = [];
  for (const row of html.split(/<tr[\s>]/).slice(1)) {
    const rowNo = row.match(/id="0R(\d+)"/);
    if (!rowNo) continue;
    const cells = row.split(/<td[\s>]/).slice(1);
    const i = cells.findIndex(c => c.includes("sheets-images-rt/"));
    if (i < 0 || !cells[i + 1]) continue;
    const name = decode(cells[i + 1].replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/^[^>]*>/, ""));
    if (name) starts.push({ row: Number(rowNo[1]), key: normName(name) });
  }
  starts.sort((a, b) => a.row - b.row);

  // 2) 떠 있는 그림들: id → 그림 주소, 그리고 위치(행, 열, 칸 안 x좌표)
  const src = new Map();
  for (const m of html.matchAll(/id='(embed_\d+)'[^>]*><img src='https:\/\/docs\.google\.com\/sheets-images-rt\/([^'=]+)/g)) src.set(m[1], m[2]);
  const iconOf = new Map(); // 니케 이름 → 속성 아이콘 주소
  for (const m of html.matchAll(/posObj\('0', '(embed_\d+)', (\d+), (\d+), (\d+), \d+\)/g)) {
    const [, id, row, col, x] = m;
    // 속성 아이콘 = 초상화 칸(B열 = 1)의 오른쪽(x ≥ 40)에 놓인 것. 왼쪽 위 것은 버스트 아이콘
    if (Number(col) !== 1 || Number(x) < 40 || !src.has(id)) continue;
    let owner = null;
    for (const s of starts) if (s.row <= Number(row)) owner = s; else break;
    if (owner) iconOf.set(owner.key, src.get(id));
  }

  // 3) 기준 니케로 아이콘 주소 → 속성 정하기
  const elementOfIcon = new Map();
  for (const [name, element] of Object.entries(ELEMENT_ANCHORS)) {
    const icon = iconOf.get(normName(name));
    if (icon) elementOfIcon.set(icon, element);
  }
  for (const [key, icon] of iconOf) {
    if (elementOfIcon.has(icon)) result.set(key, elementOfIcon.get(icon));
  }
  return result;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}
