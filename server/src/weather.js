// 구장 날씨: Open-Meteo 시간별 예보 (키 없이 쓸 수 있고, 상업용은 HIT_WEATHER_KEY 로 유료 주소를 쓴다).
// 경기 시작 1시간 전부터 3시간 뒤까지 기온·강수 확률·하늘, 그리고 우천 취소 가능성(강수 확률 기준).
// 고척은 돔이라 비와 상관없다.

// 구장 이름(네이버 stadium) → 좌표. 제2구장도 넣어 둔다.
export const STADIUMS = {
  잠실: { name: '잠실야구장', lat: 37.5122, lon: 127.0719 },
  고척: { name: '고척스카이돔', lat: 37.4982, lon: 126.8671, dome: true },
  문학: { name: '인천SSG랜더스필드', lat: 37.4370, lon: 126.6933 },
  인천: { name: '인천SSG랜더스필드', lat: 37.4370, lon: 126.6933 },
  수원: { name: '수원KT위즈파크', lat: 37.2997, lon: 127.0097 },
  대전: { name: '대전 한화생명볼파크', lat: 36.3165, lon: 127.4290 },
  대구: { name: '대구 삼성라이온즈파크', lat: 35.8411, lon: 128.6815 },
  광주: { name: '광주-기아 챔피언스필드', lat: 35.1682, lon: 126.8889 },
  창원: { name: '창원NC파크', lat: 35.2225, lon: 128.5823 },
  사직: { name: '사직야구장', lat: 35.1940, lon: 129.0615 },
  포항: { name: '포항야구장', lat: 36.0080, lon: 129.3590 },
  울산: { name: '울산 문수야구장', lat: 35.5321, lon: 129.2655 },
  청주: { name: '청주야구장', lat: 36.6386, lon: 127.4699 },
};

export function stadiumOf(name) {
  if (!name) return null;
  const key = Object.keys(STADIUMS).find((k) => name.includes(k));
  return key ? { key, ...STADIUMS[key] } : null;
}

// WMO 날씨 코드 → 하늘
export function skyOf(code) {
  if (code == null) return { sky: 'cloudy', label: '-' };
  if (code === 0) return { sky: 'clear', label: '맑음' };
  if (code <= 2) return { sky: 'partly', label: '구름 조금' };
  if (code === 3) return { sky: 'cloudy', label: '흐림' };
  if (code === 45 || code === 48) return { sky: 'fog', label: '안개' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { sky: 'snow', label: '눈' };
  if (code >= 95) return { sky: 'storm', label: '뇌우' };
  if (code >= 51 && code <= 57) return { sky: 'rain', label: '이슬비' };
  if (code >= 61) return { sky: 'rain', label: code >= 63 && code !== 80 ? '비' : '약한 비' };
  return { sky: 'cloudy', label: '흐림' };
}

/** 강수 확률·강수량으로 우천 취소 가능성: high · medium · low (돔은 dome) */
export function rainRisk(hours, dome) {
  if (dome) return 'dome';
  const pop = Math.max(0, ...hours.map((h) => h.pop ?? 0));
  const mm = hours.reduce((s, h) => s + (h.precip ?? 0), 0);
  if (pop >= 70 || mm >= 5) return 'high';
  if (pop >= 40 || mm >= 1) return 'medium';
  return 'low';
}

/** Open-Meteo 응답에서 경기 시간대만 골라 앱이 쓰는 모양으로 */
export function gameWeather(json, game, stadium) {
  const h = json?.hourly;
  if (!h?.time?.length || !game.startsAt) return null;
  // 응답 시각은 한국 시간 "2026-10-29T18:00" (timezone=Asia/Seoul)
  const start = new Date(Date.parse(game.startsAt) + 9 * 3600_000).toISOString().slice(0, 13) + ':00';
  const i = h.time.indexOf(start);
  if (i < 0) return null;
  const at = (k) => ({
    time: h.time[k].slice(11, 16),
    temp: h.temperature_2m?.[k] == null ? null : Math.round(h.temperature_2m[k]),
    pop: h.precipitation_probability?.[k] ?? null,
    precip: h.precipitation?.[k] ?? null,
    ...skyOf(h.weather_code?.[k]),
  });
  const hours = [];
  for (let k = Math.max(0, i - 1); k <= Math.min(h.time.length - 1, i + 3); k++) hours.push(at(k));
  const now = at(i);
  const during = hours.filter((x) => x.time >= now.time);
  return {
    gameId: game.id,
    stadium: stadium.name,
    dome: !!stadium.dome,
    temp: now.temp,
    pop: now.pop,
    sky: now.sky,
    label: now.label,
    wind: h.wind_speed_10m?.[i] == null ? null : Math.round(h.wind_speed_10m[i] / 3.6 * 10) / 10, // km/h → m/s
    risk: rainRisk(during, stadium.dome),
    hours: hours.map(({ precip, ...x }) => x),
    source: 'Open-Meteo',
  };
}

export function createWeather({ fetch = globalThis.fetch, apiKey = null, now = () => Date.now(), ttlMs = 30 * 60 * 1000, log = () => {} } = {}) {
  const cache = new Map(); // stadium key → { at, json }

  async function forecast(stadium) {
    const hit = cache.get(stadium.key);
    if (hit && now() - hit.at < ttlMs) return hit.json;
    const q = new URLSearchParams({
      latitude: String(stadium.lat), longitude: String(stadium.lon),
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m',
      timezone: 'Asia/Seoul', forecast_days: '8',
    });
    if (apiKey) q.set('apikey', apiKey);
    const host = apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
    const res = await fetch(`${host}/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const json = await res.json();
    cache.set(stadium.key, { at: now(), json });
    return json;
  }

  return {
    /** 경기 시간 날씨. 구장을 모르거나, 끝났거나, 예보 범위(7일) 밖이면 null */
    async forGame(game) {
      const stadium = stadiumOf(game.stadium);
      if (!stadium || !game.startsAt || ['final', 'canceled'].includes(game.status)) return null;
      const until = Date.parse(game.startsAt) - now();
      if (until > 7 * 86_400_000 || until < -5 * 3600_000) return null;
      try {
        return gameWeather(await forecast(stadium), game, stadium);
      } catch (err) {
        log(`날씨 실패 ${stadium.key}: ${err.message}`);
        return null;
      }
    },
  };
}
