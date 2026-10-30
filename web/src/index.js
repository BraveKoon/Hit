// 페이지·이미지는 public/ 에서 Workers Static Assets 가 서빙하고,
// 이 워커는 출시 알림 신청(D1)만 처리한다.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const TEAMS = ["KIA", "삼성", "LG", "두산", "KT", "SSG", "롯데", "한화", "NC", "키움"];

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/api/waitlist/count" && req.method === "GET") {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist").first();
      return json({ count: row?.n ?? 0 });
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

    return env.ASSETS.fetch(req);
  },
};
