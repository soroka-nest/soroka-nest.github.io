/**
 * 까치집 — 대화형 부동산 시장 대시보드 (client-side, DuckDB-WASM + ECharts)
 *
 * 동작 개요
 * ---------
 *  1. DuckDB-WASM 을 jsDelivr ESM 번들에서 동적 import 하고, MVP 폴백을
 *     포함한 공식 번들 선택 절차(getJsDelivrBundles + selectBundle)로 워커를
 *     기동한다.
 *  2. /assets/data/market.parquet 을 registerFileURL 로 등록 후, 커넥션에서
 *     SQL 로 질의한다(파일을 통째로 메모리에 올리지 않고 HTTP range/lazy).
 *  3. ECharts(UMD)는 <script> 주입 + onload 대기로 로드한다.
 *  4. 컨트롤(시도/시군구/거래유형/기간/지표) 변경 시 클라이언트 SQL 로
 *     재질의 후 라인·막대 차트를 즉시 다시 그린다.
 *  5. 다크/라이트 모드는 chirpy 의 <html data-mode> 및 prefers-color-scheme
 *     를 감지하여 ECharts 테마와 카드 스타일을 동기화한다.
 *
 * 참고한 DuckDB-WASM API (v1.29.0)
 * --------------------------------
 *  - `import * as duckdb from "@duckdb/duckdb-wasm"` (ESM 번들)
 *  - `duckdb.getJsDelivrBundles()` → CDN 호스팅 wasm/worker 번들 목록
 *  - `await duckdb.selectBundle(bundles)` → 브라우저에 맞는 번들 선택
 *    (bundleselection, MVP 폴백 포함)
 *  - `new Worker(bundle.mainWorker)` + `new duckdb.ConsoleLogger()`
 *  - `new duckdb.AsyncDuckDB(logger, worker)`
 *  - `await db.instantiate(bundle.mainModule, bundle.pthreadWorker)`
 *  - `await db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false)`
 *  - `const conn = await db.connect()` ; `await conn.query(sql)` (Arrow 결과)
 *  공식 문서: https://duckdb.org/docs/api/wasm/instantiation
 */

const DUCKDB_ESM =
  "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
const ECHARTS_UMD =
  "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";
const PARQUET_URL = "/assets/data/market.parquet";

const MOUNT_ID = "re-dash";

/* ── 작은 DOM 헬퍼 ─────────────────────────────────────────────────────── */
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
};

/* ── 스타일 (chirpy 변수 사용, 라이트/다크 모두 대응) ──────────────────── */
function injectStyles() {
  if (document.getElementById("re-dash-style")) return;
  const css = `
  #${MOUNT_ID}{margin:1rem 0;}
  #${MOUNT_ID} .red-card{
    border:1px solid var(--card-border-color,rgba(0,0,0,.08));
    background:var(--card-bg,#fff);
    border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem;
    box-shadow:var(--card-shadow,0 0 5px rgba(0,0,0,.05));
  }
  #${MOUNT_ID} .red-controls{
    display:flex;flex-wrap:wrap;gap:.85rem 1.1rem;align-items:flex-end;
  }
  #${MOUNT_ID} .red-field{display:flex;flex-direction:column;gap:.3rem;min-width:9rem;}
  #${MOUNT_ID} .red-field label{
    font-size:.78rem;font-weight:600;opacity:.75;letter-spacing:.02em;
  }
  #${MOUNT_ID} select{
    appearance:none;-webkit-appearance:none;
    padding:.45rem .7rem;border-radius:8px;
    border:1px solid var(--input-focus-border-color,rgba(0,0,0,.18));
    background:var(--main-bg,transparent);color:inherit;font-size:.9rem;
    cursor:pointer;min-width:9rem;
  }
  #${MOUNT_ID} select:focus{outline:2px solid var(--link-color,#1d7df2);outline-offset:1px;}
  #${MOUNT_ID} .red-seg{display:inline-flex;border-radius:8px;overflow:hidden;
    border:1px solid var(--input-focus-border-color,rgba(0,0,0,.18));}
  #${MOUNT_ID} .red-seg button{
    appearance:none;border:0;background:transparent;color:inherit;
    padding:.45rem .85rem;font-size:.88rem;cursor:pointer;line-height:1.2;
  }
  #${MOUNT_ID} .red-seg button + button{
    border-left:1px solid var(--input-focus-border-color,rgba(0,0,0,.18));}
  #${MOUNT_ID} .red-seg button.active{
    background:var(--link-color,#1d7df2);color:#fff;font-weight:600;}
  #${MOUNT_ID} .red-chart{width:100%;height:340px;}
  #${MOUNT_ID} .red-chart.bar{height:260px;}
  #${MOUNT_ID} .red-title{font-size:.95rem;font-weight:700;margin:0 0 .6rem;}
  #${MOUNT_ID} .red-msg{
    text-align:center;padding:2.4rem 1rem;opacity:.75;font-size:.95rem;
    line-height:1.6;
  }
  #${MOUNT_ID} .red-spin{
    width:1.6rem;height:1.6rem;border-radius:50%;margin:0 auto .8rem;
    border:3px solid var(--card-border-color,rgba(0,0,0,.15));
    border-top-color:var(--link-color,#1d7df2);
    animation:red-spin .8s linear infinite;
  }
  @keyframes red-spin{to{transform:rotate(360deg);}}
  @media (max-width:576px){
    #${MOUNT_ID} .red-field,#${MOUNT_ID} select{min-width:0;width:100%;}
    #${MOUNT_ID} .red-controls{gap:.7rem;}
    #${MOUNT_ID} .red-chart{height:300px;}
  }`;
  document.head.appendChild(
    el("style", { id: "re-dash-style", text: css })
  );
}

/* ── 다크모드 감지 ─────────────────────────────────────────────────────── */
function isDark() {
  const mode = document.documentElement.getAttribute("data-mode");
  if (mode === "dark") return true;
  if (mode === "light") return false;
  // chirpy 가 data-mode 를 설정하지 않은 경우(시스템 추종) 미디어 쿼리 사용
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/* ── 상태 메시지 렌더 ──────────────────────────────────────────────────── */
function showMessage(root, opts) {
  const { text, spinner = false } = opts;
  root.innerHTML = "";
  const card = el("div", { class: "red-card" }, [
    el("div", { class: "red-msg" }, [
      spinner ? el("div", { class: "red-spin" }) : null,
      el("div", { html: text }),
    ]),
  ]);
  root.appendChild(card);
}

/* ── ECharts(UMD) 로더 ─────────────────────────────────────────────────── */
function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  return new Promise((resolve, reject) => {
    const s = el("script", { src: ECHARTS_UMD });
    s.onload = () =>
      window.echarts
        ? resolve(window.echarts)
        : reject(new Error("ECharts 로드 실패"));
    s.onerror = () => reject(new Error("ECharts 스크립트 요청 실패"));
    document.head.appendChild(s);
  });
}

/* ── DuckDB-WASM 초기화 ────────────────────────────────────────────────── */
async function initDuckDB() {
  // ESM 번들을 동적 import (모듈 스크립트 컨텍스트에서 안전)
  const duckdb = await import(/* @vite-ignore */ DUCKDB_ESM);

  // 공식 권장 절차: jsDelivr 호스팅 번들 목록 → 브라우저에 맞는 번들 선택
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles); // MVP 폴백 포함

  // worker 는 cross-origin 이므로 Blob URL 로 감싸 동일출처 워커로 기동
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "text/javascript",
    })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  // parquet 을 HTTP 프로토콜로 등록 (lazy fetch)
  await db.registerFileURL(
    "market.parquet",
    new URL(PARQUET_URL, window.location.origin).href,
    duckdb.DuckDBDataProtocol.HTTP,
    false
  );

  const conn = await db.connect();
  return { duckdb, db, conn };
}

/* ── SQL 문자열 리터럴 이스케이프 (작은따옴표 → '') ────────────────────── */
const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";

/* ── 메인 ──────────────────────────────────────────────────────────────── */
async function main() {
  const root = document.getElementById(MOUNT_ID);
  if (!root) return;
  injectStyles();

  showMessage(root, {
    text: "대시보드를 불러오는 중입니다…",
    spinner: true,
  });

  let conn, echarts;
  try {
    [{ conn }, echarts] = await Promise.all([initDuckDB(), loadECharts()]);
  } catch (e) {
    console.error("[re-dash] 초기화 실패", e);
    showMessage(root, {
      text:
        "대시보드 엔진을 불러오지 못했습니다.<br>네트워크 상태를 확인 후 " +
        "새로고침 해주세요.",
    });
    return;
  }

  // 데이터 가용성 점검 — 없거나 비어 있으면 친절히 안내하고 종료
  let regionRows;
  try {
    const probe = await conn.query(
      `SELECT sido, region, sgg_cd
         FROM read_parquet('market.parquet')
        GROUP BY sido, region, sgg_cd`
    );
    regionRows = probe.toArray().map((r) => ({
      sido: r.sido,
      region: r.region,
      sgg_cd: r.sgg_cd,
    }));
  } catch (e) {
    console.warn("[re-dash] parquet 미존재/오류", e);
    showMessage(root, {
      text: "대시보드 데이터가 아직 준비되지 않았습니다. 곧 제공됩니다.",
    });
    return;
  }
  if (!regionRows || regionRows.length === 0) {
    showMessage(root, {
      text: "대시보드 데이터가 아직 준비되지 않았습니다. 곧 제공됩니다.",
    });
    return;
  }

  /* ── 시도 → 시군구 매핑 구성 ───────────────────────────────────────── */
  const sidoMap = new Map(); // sido -> [{region, sgg_cd}]
  for (const r of regionRows) {
    if (!sidoMap.has(r.sido)) sidoMap.set(r.sido, []);
    sidoMap.get(r.sido).push({ region: r.region, sgg_cd: r.sgg_cd });
  }
  const sidoList = [...sidoMap.keys()].sort((a, b) =>
    String(a).localeCompare(String(b), "ko")
  );
  for (const list of sidoMap.values())
    list.sort((a, b) => String(a.region).localeCompare(String(b.region), "ko"));

  /* ── 상태 ──────────────────────────────────────────────────────────── */
  const state = {
    sido: sidoList[0],
    sgg_cd: sidoMap.get(sidoList[0])[0].sgg_cd,
    trade_type: "매매",
    period: "3y", // '1y' | '3y' | 'all'
    metric: "median_price", // 'median_price' | 'median_ppm'
  };

  /* ── UI 골격 ───────────────────────────────────────────────────────── */
  root.innerHTML = "";

  const sidoSel = el("select", { "aria-label": "시도 선택" });
  const sggSel = el("select", { "aria-label": "시군구 선택" });
  const periodSel = el("select", { "aria-label": "기간 선택" }, [
    el("option", { value: "1y", text: "최근 1년" }),
    el("option", { value: "3y", text: "최근 3년", selected: "selected" }),
    el("option", { value: "all", text: "전체 기간" }),
  ]);

  const fillSido = () => {
    sidoSel.innerHTML = "";
    for (const s of sidoList)
      sidoSel.appendChild(
        el("option", {
          value: s,
          text: s,
          ...(s === state.sido ? { selected: "selected" } : {}),
        })
      );
  };
  const fillSgg = () => {
    sggSel.innerHTML = "";
    const list = sidoMap.get(state.sido) || [];
    for (const r of list)
      sggSel.appendChild(
        el("option", {
          value: r.sgg_cd,
          text: r.region,
          ...(r.sgg_cd === state.sgg_cd ? { selected: "selected" } : {}),
        })
      );
  };
  fillSido();
  fillSgg();

  // 거래유형 세그먼트
  const tradeTypes = ["매매", "전세", "월세"];
  const segTrade = el("div", { class: "red-seg", role: "group" });
  const tradeBtns = tradeTypes.map((t) =>
    el("button", {
      type: "button",
      text: t,
      class: t === state.trade_type ? "active" : "",
    })
  );
  tradeBtns.forEach((b) => segTrade.appendChild(b));

  // 지표 토글 세그먼트
  const metricDefs = [
    { key: "median_price", label: "총액(만원)" },
    { key: "median_ppm", label: "㎡당(만원)" },
  ];
  const segMetric = el("div", { class: "red-seg", role: "group" });
  const metricBtns = metricDefs.map((m) =>
    el("button", {
      type: "button",
      text: m.label,
      class: m.key === state.metric ? "active" : "",
    })
  );
  metricBtns.forEach((b) => segMetric.appendChild(b));

  const field = (labelText, control) =>
    el("div", { class: "red-field" }, [
      el("label", { text: labelText }),
      control,
    ]);

  const controlsCard = el("div", { class: "red-card" }, [
    el("div", { class: "red-controls" }, [
      field("시도", sidoSel),
      field("시군구", sggSel),
      field("거래유형", segTrade),
      field("기간", periodSel),
      field("지표", segMetric),
    ]),
  ]);

  const priceChartEl = el("div", { class: "red-chart" });
  const volChartEl = el("div", { class: "red-chart bar" });
  const priceTitle = el("p", { class: "red-title" });
  const volTitle = el("p", {
    class: "red-title",
    text: "월별 거래량 (건)",
  });
  const chartsCard = el("div", { class: "red-card" }, [
    priceTitle,
    priceChartEl,
  ]);
  const volCard = el("div", { class: "red-card" }, [volTitle, volChartEl]);

  root.appendChild(controlsCard);
  root.appendChild(chartsCard);
  root.appendChild(volCard);

  /* ── ECharts 인스턴스 ──────────────────────────────────────────────── */
  let priceChart = echarts.init(
    priceChartEl,
    isDark() ? "dark" : null
  );
  let volChart = echarts.init(volChartEl, isDark() ? "dark" : null);

  const onResize = () => {
    priceChart.resize();
    volChart.resize();
  };
  window.addEventListener("resize", onResize);

  // 다크/라이트 전환 시 테마 재적용 (ECharts 는 테마를 init 시점에 고정하므로
  // dispose 후 재생성)
  const reinitForTheme = () => {
    const dark = isDark();
    priceChart.dispose();
    volChart.dispose();
    priceChart = echarts.init(priceChartEl, dark ? "dark" : null);
    volChart = echarts.init(volChartEl, dark ? "dark" : null);
    render();
  };
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const mqHandler = () => reinitForTheme();
    mq.addEventListener
      ? mq.addEventListener("change", mqHandler)
      : mq.addListener(mqHandler);
  }
  // chirpy 다크모드 토글은 <html data-mode> 속성을 바꾸므로 이를 관찰
  new MutationObserver(reinitForTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode"],
  });

  /* ── 데이터 질의 & 렌더 ────────────────────────────────────────────── */
  let renderToken = 0;

  async function fetchSeries() {
    const months = state.period === "1y" ? 12 : state.period === "3y" ? 36 : null;
    // 기간 필터: 데이터의 최대 ym 기준 상대 N개월 (ym 은 'YYYY-MM' 문자열)
    let sql = `
      WITH base AS (
        SELECT ym,
               CAST(${state.metric} AS DOUBLE) AS metric_val,
               CAST(volume AS BIGINT)          AS volume
          FROM read_parquet('market.parquet')
         WHERE sgg_cd = ${sqlStr(state.sgg_cd)}
           AND trade_type = ${sqlStr(state.trade_type)}
      )`;
    if (months) {
      sql += `
      , bounded AS (
        SELECT * FROM base
         WHERE ym >= (
           SELECT strftime(
             date_trunc('month',
               strptime((SELECT max(ym) FROM base) || '-01', '%Y-%m-%d')
             ) - INTERVAL '${months - 1}' MONTH, '%Y-%m')
         )
      )
      SELECT ym, metric_val, volume FROM bounded ORDER BY ym`;
    } else {
      sql += `
      SELECT ym, metric_val, volume FROM base ORDER BY ym`;
    }
    const res = await conn.query(sql);
    return res.toArray().map((r) => ({
      ym: r.ym,
      metric_val: r.metric_val == null ? null : Number(r.metric_val),
      volume: r.volume == null ? 0 : Number(r.volume),
    }));
  }

  function regionLabel() {
    const list = sidoMap.get(state.sido) || [];
    const hit = list.find((r) => r.sgg_cd === state.sgg_cd);
    return `${state.sido} ${hit ? hit.region : ""}`.trim();
  }

  async function render() {
    const token = ++renderToken;
    priceChart.showLoading("default", {
      text: "불러오는 중…",
      maskColor: "rgba(0,0,0,0)",
    });
    let rows;
    try {
      rows = await fetchSeries();
    } catch (e) {
      console.error("[re-dash] 질의 실패", e);
      priceChart.hideLoading();
      priceChart.clear();
      volChart.clear();
      priceTitle.textContent = "데이터를 불러오지 못했습니다.";
      return;
    }
    if (token !== renderToken) return; // 더 최신 요청이 있으면 폐기
    priceChart.hideLoading();

    const metricLabel =
      state.metric === "median_price"
        ? "중위가격(만원)"
        : "㎡당 중위가격(만원)";
    priceTitle.textContent = `${regionLabel()} · ${state.trade_type} · ${metricLabel}`;

    if (!rows.length) {
      priceChart.clear();
      volChart.clear();
      priceTitle.textContent = `${regionLabel()} · ${state.trade_type} — 해당 조건의 데이터가 없습니다.`;
      return;
    }

    const xs = rows.map((r) => r.ym);
    const ys = rows.map((r) => r.metric_val);
    const vols = rows.map((r) => r.volume);
    const axisFmt = (v) =>
      v >= 10000
        ? (v / 10000).toFixed(1) + "억"
        : Math.round(v).toLocaleString("ko-KR");

    const gridLine = isDark()
      ? "rgba(255,255,255,.12)"
      : "rgba(0,0,0,.08)";

    priceChart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 56, right: 18, top: 28, bottom: 40 },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v) =>
            v == null ? "-" : Number(v).toLocaleString("ko-KR") + " 만원",
        },
        xAxis: {
          type: "category",
          data: xs,
          axisLabel: { hideOverlap: true },
          axisLine: { lineStyle: { color: gridLine } },
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { formatter: axisFmt },
          splitLine: { lineStyle: { color: gridLine } },
        },
        dataZoom:
          xs.length > 18
            ? [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }]
            : [],
        series: [
          {
            name: metricLabel,
            type: "line",
            data: ys,
            smooth: true,
            showSymbol: xs.length <= 24,
            symbolSize: 5,
            connectNulls: true,
            lineStyle: { width: 2.4 },
            areaStyle: { opacity: 0.08 },
            color: "#1d7df2",
          },
        ],
      },
      true
    );

    volChart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 48, right: 18, top: 18, bottom: 36 },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v) =>
            v == null ? "-" : Number(v).toLocaleString("ko-KR") + " 건",
        },
        xAxis: {
          type: "category",
          data: xs,
          axisLabel: { hideOverlap: true },
          axisLine: { lineStyle: { color: gridLine } },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            formatter: (v) => Number(v).toLocaleString("ko-KR"),
          },
          splitLine: { lineStyle: { color: gridLine } },
        },
        series: [
          {
            name: "거래량",
            type: "bar",
            data: vols,
            itemStyle: { borderRadius: [3, 3, 0, 0], color: "#27b376" },
            barMaxWidth: 26,
          },
        ],
      },
      true
    );
  }

  /* ── 이벤트 바인딩 ─────────────────────────────────────────────────── */
  sidoSel.addEventListener("change", () => {
    state.sido = sidoSel.value;
    const list = sidoMap.get(state.sido) || [];
    state.sgg_cd = list.length ? list[0].sgg_cd : null;
    fillSgg();
    render();
  });
  sggSel.addEventListener("change", () => {
    state.sgg_cd = sggSel.value;
    render();
  });
  periodSel.addEventListener("change", () => {
    state.period = periodSel.value;
    render();
  });
  tradeBtns.forEach((b, i) =>
    b.addEventListener("click", () => {
      state.trade_type = tradeTypes[i];
      tradeBtns.forEach((x, j) =>
        x.classList.toggle("active", j === i)
      );
      render();
    })
  );
  metricBtns.forEach((b, i) =>
    b.addEventListener("click", () => {
      state.metric = metricDefs[i].key;
      metricBtns.forEach((x, j) =>
        x.classList.toggle("active", j === i)
      );
      render();
    })
  );

  await render();
}

// 모듈 스크립트는 defer 처럼 동작하지만, 마운트 보장을 위해 방어적으로 처리
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => console.error("[re-dash] 치명적 오류", e));
  });
} else {
  main().catch((e) => console.error("[re-dash] 치명적 오류", e));
}
