// =========================================================
// BAND MANAGER — AI 포스터 디자인 (Supabase Edge Function)
//
// 앱이 페스티벌 정보 + 원하는 분위기를 보내면, Claude 가 포스터 "디자인 시안" 3개를
// JSON 으로 만들어 돌려줍니다. 실제 그림은 앱(js/poster.js)이 이 시안대로 Canvas 에 그립니다.
//
// 배포:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//        supabase functions deploy poster-ai
// 로그인한 회원만 호출할 수 있고, 회원당 하루 횟수 제한이 있습니다 (schema.sql 의 use_ai_quota).
// =========================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const DAILY_LIMIT = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LAYOUTS = ["ripple", "grid", "stack", "orbit", "split", "sunburst"] as const;
const PATTERNS = ["none", "waves", "rings", "stripes", "grid", "dots", "rays", "blobs"] as const;
const FONTS = ["wave", "tech", "grotesk", "mono"] as const;
const SCALES = ["huge", "large", "normal"] as const;
const GRAIN = ["none", "light", "heavy"] as const;

const HEX = { type: "string", description: "#RRGGBB 형식의 6자리 hex 색" };
const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "시안 이름 (한국어, 2~12자)" },
    rationale: { type: "string", description: "이 시안을 고른 이유 한 문장 (한국어)" },
    layout: { type: "string", enum: [...LAYOUTS] },
    pattern: { type: "string", enum: [...PATTERNS] },
    headlineFont: { type: "string", enum: [...FONTS] },
    palette: {
      type: "object",
      properties: { bg: HEX, fg: HEX, accent: HEX, accent2: HEX },
      required: ["bg", "fg", "accent", "accent2"],
      additionalProperties: false,
    },
    kicker: { type: "string", description: "제목 위 작은 문구 (28자 이내)" },
    tagline: { type: "string", description: "포스터 카피 한 줄 (40자 이내)" },
    footerNote: { type: "string", description: "하단 작은 문구 (40자 이내, 예: 입장 안내)" },
    headlinerScale: { type: "string", enum: [...SCALES] },
    uppercase: { type: "boolean", description: "라인업·제목을 대문자로 쓸지" },
    grain: { type: "string", enum: [...GRAIN] },
    seed: { type: "integer", description: "패턴 무작위 배치용 아무 정수" },
  },
  required: ["name", "rationale", "layout", "pattern", "headlineFont", "palette", "kicker", "tagline", "footerNote", "headlinerScale", "uppercase", "grain", "seed"],
  additionalProperties: false,
};
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { concepts: { type: "array", items: CONCEPT_SCHEMA } },
  required: ["concepts"],
  additionalProperties: false,
};

const SYSTEM = `You are the art director for a music-festival poster generator. You do not draw; you choose a design spec that a Canvas renderer (1080x1350 px, portrait) will draw exactly. Return three concepts that are clearly different from each other in layout, palette and mood, and that fit the festival's name, theme, venue and the genres in its lineup. If the user describes a mood, all three concepts should answer it in different ways.

What the renderer can do:
- layout "ripple": centred, wavy distorted serif title, lineup centred by day, info rows top and bottom. Calm, organic.
- layout "grid": the headliner's name repeated huge across two rows with accent blocks, lineup in day columns below. Loud, editorial.
- layout "stack": title words stacked and left-aligned filling the width, thin rules, left-aligned tiered lineup, date set vertically on the right edge. Swiss/typographic.
- layout "orbit": a large accent circle behind the centred title, lineup in two columns below. Playful, retro.
- layout "split": a solid accent panel on the left with the title and date rotated 90°, lineup listed on the right. Modern, clean.
- layout "sunburst": light rays from the horizon at the bottom, title in the upper half, lineup centred. Summery, outdoor.
- pattern draws behind everything in a translucent mix of fg and accent2: waves, rings, stripes (diagonal), grid, dots (halftone), rays, blobs, or none.
- headlineFont: "wave" (Instrument Serif with a liquid ripple distortion), "tech" (Michroma, wide techno display), "grotesk" (heavy grotesque sans), "mono" (Space Mono).
- palette: bg = background, fg = all main text (must contrast strongly with bg, at least 4.5:1), accent = title / highlight colour, accent2 = secondary shapes and pattern.

Copy: kicker, tagline and footerNote are printed on the poster. Write them in the language the festival info uses (Korean info -> Korean copy, but short English kickers like "MUSIC & ARTS FESTIVAL" are fine). Keep them short and specific to this festival, never generic filler. Do not invent artist names, dates or prices. name and rationale are shown to the organiser in Korean.`;

type Concept = Record<string, unknown>;
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** 모델 출력을 한 번 더 검사해서 렌더러가 항상 그릴 수 있는 값만 돌려줌 */
function normalize(c: Concept) {
  const p = (c.palette ?? {}) as Record<string, unknown>;
  const bg = hex(p.bg, "#f2541b");
  let fg = hex(p.fg, "#fff8f2");
  if (contrast(bg, fg) < 4.5) fg = contrast(bg, "#141210") >= contrast(bg, "#ffffff") ? "#141210" : "#ffffff";
  return {
    name: str(c.name, 24) || "AI 시안",
    rationale: str(c.rationale, 160),
    layout: pick(c.layout, LAYOUTS, "ripple"),
    pattern: pick(c.pattern, PATTERNS, "none"),
    headlineFont: pick(c.headlineFont, FONTS, "wave"),
    palette: { bg, fg, accent: hex(p.accent, "#7f5cff"), accent2: hex(p.accent2, "#d6ff3a") },
    kicker: str(c.kicker, 28),
    tagline: str(c.tagline, 40),
    footerNote: str(c.footerNote, 40),
    headlinerScale: pick(c.headlinerScale, SCALES, "large"),
    uppercase: c.uppercase !== false,
    grain: pick(c.grain, GRAIN, "light"),
    seed: Number.isInteger(c.seed) ? Math.abs(c.seed as number) % 100000 : Math.floor(Math.random() * 100000),
  };
}

/** 앱이 보낸 페스티벌 정보 중 필요한 것만, 길이를 제한해서 */
function festivalBrief(f: Record<string, unknown>) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    name: str(f.name, 40),
    startDate: str(f.startDate, 10),
    days: Math.max(1, Math.min(5, Number(f.days) || 1)),
    venue: str(f.venue, 60),
    theme: str(f.theme, 120),
    hours: str(f.hours, 20),
    stages: arr(f.stages).slice(0, 8).map((s) => str(s, 30)),
    lineup: arr(f.lineup).slice(0, 60).map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      return { name: str(x.name, 40), genre: str(x.genre, 30), headliner: !!x.headliner, day: Number(x.day) || null };
    }),
  };
}

const client = new Anthropic(); // ANTHROPIC_API_KEY (supabase secrets)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // 1) 로그인한 회원인지 확인
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "로그인이 필요합니다" }, 401);

  // 2) 하루 사용량
  const { data: ok, error: qErr } = await sb.rpc("use_ai_quota", { daily_limit: DAILY_LIMIT });
  if (qErr) return json({ error: "사용량 확인 실패 — supabase/schema.sql 을 다시 실행했는지 확인하세요" }, 500);
  if (!ok) return json({ error: `오늘 AI 디자인 사용 횟수(${DAILY_LIMIT}회)를 모두 썼습니다` }, 429);

  // 3) 입력
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "잘못된 요청" }, 400); }
  const brief = festivalBrief((body.festival ?? {}) as Record<string, unknown>);
  if (!brief.name) return json({ error: "페스티벌 이름이 없습니다" }, 400);
  const mood = str(body.mood, 300);

  const prompt = [
    "Festival info (JSON):",
    JSON.stringify(brief, null, 1),
    mood ? `\nThe organiser wants this mood: ${mood}` : "\nNo mood given — pick three strong, different directions that suit this festival.",
    "\nReturn exactly 3 concepts.",
  ].join("\n");

  // 4) Claude 호출 — 구조화 출력으로 스키마에 맞는 JSON 만 받음
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // 안전 분류기가 거절하면 서버에서 다른 모델로 자동 재시도
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });

    if (response.stop_reason === "refusal") return json({ error: "AI가 이 요청으로는 디자인을 만들 수 없다고 답했습니다. 분위기 설명을 바꿔 보세요" }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "AI 응답이 너무 길어 잘렸습니다. 다시 시도하세요" }, 502);

    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(text) as { concepts?: Concept[] };
    const concepts = (parsed.concepts ?? []).slice(0, 3).map(normalize);
    if (!concepts.length) return json({ error: "AI가 시안을 만들지 못했습니다" }, 502);
    return json({ concepts });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "AI 서버가 바쁩니다. 잠시 후 다시 시도하세요" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "AI 키 설정 오류 (ANTHROPIC_API_KEY)" }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 오류 (${e.status})` }, 502);
    if (e instanceof SyntaxError) return json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도하세요" }, 502);
    console.error(e);
    return json({ error: "AI 디자인 생성 실패" }, 500);
  }
});
