const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const TEAMS = ["KIA", "삼성", "LG", "두산", "KT", "SSG", "롯데", "한화", "NC", "키움"];

async function page(env) {
  const { results } = await env.DB.prepare("SELECT icon, title, body FROM features ORDER BY sort").all();
  const cards = results
    .map((f) => `<article><div class="i">${esc(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></article>`)
    .join("");
  const teams = TEAMS.map((t) => `<option>${t}</option>`).join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HIT — KBO 야구 알림 앱</title>
<meta name="description" content="내 팀 경기가 시작하고, 점수가 나고, 끝나는 순간을 잠금화면으로 알려주는 KBO 앱.">
<style>
:root{--bg:#0b1b3a;--fg:#f4f7ff;--mut:#9fb0d3;--card:#13284f;--acc:#ff4d4d}
@media(prefers-color-scheme:light){:root{--bg:#f5f7fc;--fg:#0b1b3a;--mut:#51628a;--card:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:960px;margin:0 auto;padding:0 16px 64px}
.hero{padding:72px 0 40px;text-align:center}
.hero h1{font-size:clamp(40px,10vw,72px);margin:0;letter-spacing:-2px}.hero h1 b{color:var(--acc)}
.hero p{color:var(--mut);font-size:18px;max-width:520px;margin:12px auto 0}
.score{display:inline-block;margin:28px 0 0;background:var(--card);border-radius:20px;padding:14px 22px;font-weight:700;box-shadow:0 8px 30px #0003}
.score small{display:block;color:var(--mut);font-weight:500}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin:32px 0}
article{background:var(--card);border-radius:18px;padding:20px}
article .i{font-size:28px}article h3{margin:6px 0 4px}article p{margin:0;color:var(--mut);font-size:15px}
form{background:var(--card);border-radius:18px;padding:24px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
input,select,button{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid #8884;background:transparent;color:inherit}
input{flex:1 1 220px}button{background:var(--acc);border:0;color:#fff;font-weight:700;cursor:pointer}
h2{text-align:center;margin:48px 0 0}#msg{width:100%;text-align:center;color:var(--mut);margin:0}
footer{text-align:center;color:var(--mut);font-size:13px;margin-top:40px}
</style></head><body><main>
<section class="hero"><h1><b>H</b>IT</h1>
<p>내 팀 경기가 시작하고, 점수가 나고, 끝나는 순간을 잠금화면으로.</p>
<div class="score"><small>잠금화면 · 라이브 액티비티</small>KIA 1 : 4 삼성 · 3회말</div></section>
<h2>이런 걸 해요</h2>
<section class="grid">${cards}</section>
<h2>출시 알림 받기</h2><br>
<form id="f"><input name="email" type="email" required placeholder="이메일">
<select name="team"><option value="">응원 팀 (선택)</option>${teams}</select>
<button>알림 신청</button><p id="msg"></p></form>
<footer>HIT · iOS 17.2+ · 네이버 스포츠 데이터 기반</footer>
</main>
<script>
document.getElementById("f").onsubmit=async e=>{e.preventDefault();
const m=document.getElementById("msg"),d=Object.fromEntries(new FormData(e.target));
const r=await fetch("/api/waitlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
const j=await r.json();m.textContent=r.ok?"신청 완료! 출시되면 알려드릴게요 ⚾":(j.error||"오류가 났어요");if(r.ok)e.target.reset()};
</script></body></html>`;
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/api/features" && req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT icon, title, body FROM features ORDER BY sort").all();
      return json(results);
    }

    if (pathname === "/api/waitlist" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "잘못된 요청이에요" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const team = TEAMS.includes(body.team) ? body.team : null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
        return json({ error: "이메일 형식을 확인해 주세요" }, 400);
      }
      await env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, team) VALUES (?, ?)").bind(email, team).run();
      return json({ ok: true });
    }

    if (pathname === "/" && req.method === "GET") {
      return new Response(await page(env), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
