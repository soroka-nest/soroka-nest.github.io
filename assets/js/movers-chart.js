/* 포스트 내 매매 변동률 인터랙티브 차트 (ECharts).
 * compose._mv_chart_block 가 심은 <figure.mv-chart> 안의
 * <script.mv-data> JSON 을 읽어 가로 막대 + 호버 툴팁 렌더.
 * JS 미동작 시 <noscript> 정적 PNG 가 그대로 보임(점진적 향상).
 * 라이트/다크 모드는 Chirpy 의 html[data-mode] 를 따라 재초기화. */
(function () {
  "use strict";
  var FIGS = [].slice.call(document.querySelectorAll("figure.mv-chart"));
  if (!FIGS.length) return;
  var ECHARTS = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";

  function load(cb) {
    if (window.echarts) return cb();
    var s = document.createElement("script");
    s.src = ECHARTS;
    s.onload = cb;
    s.onerror = function () { /* CDN 실패 → noscript PNG 유지 */ };
    document.head.appendChild(s);
  }
  function isDark() {
    return document.documentElement.getAttribute("data-mode") === "dark";
  }
  function won(m) {
    if (m == null) return "-";
    return m >= 10000 ? (m / 10000).toFixed(1) + "억"
                      : Math.round(m).toLocaleString() + "만";
  }

  var charts = [];
  function renderAll() {
    charts.forEach(function (c) { try { c.dispose(); } catch (e) {} });
    charts = [];
    FIGS.forEach(function (fig) {
      var holder = fig.querySelector(".mv-canvas");
      var raw = fig.querySelector("script.mv-data");
      if (!holder || !raw) return;
      var d;
      try { d = JSON.parse(raw.textContent); } catch (e) { return; }
      var rows = (d.rows || []).slice().sort(function (a, b) {
        return a.d - b.d;            // 변동률 오름차순(아래=하락)
      });
      if (!rows.length) return;
      var names = rows.map(function (r) {
        return r.n + (r.a ? " " + Math.round(r.a) + "㎡" : "");
      });
      var vals = rows.map(function (r) {
        return {
          value: r.d,
          itemStyle: { color: r.d >= 0 ? "#e23b34" : "#1f6fe5" },
          _r: r
        };
      });
      var chart = window.echarts.init(holder, isDark() ? "dark" : null);
      chart.setOption({
        grid: { left: 8, right: 24, top: 10, bottom: 24,
                containLabel: true },
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            var r = p.data._r;
            return "<b>" + r.n + "</b> " + (r.a ? Math.round(r.a) + "㎡" : "")
              + "<br/>직전 " + won(r.p) + " → 최근 " + won(r.c)
              + "<br/>변동 <b>" + (r.d >= 0 ? "+" : "") + r.d + "%</b>"
              + (r.s ? " · 표본 " + r.s + "건" : "");
          }
        },
        xAxis: { type: "value", axisLabel: { formatter: "{value}%" },
                 splitLine: { lineStyle: { opacity: 0.25 } } },
        yAxis: { type: "category", data: names,
                 axisLabel: { fontSize: 11 } },
        series: [{
          type: "bar", data: vals, barMaxWidth: 18,
          label: {
            show: true, position: "right", fontSize: 11,
            formatter: function (p) {
              return (p.value >= 0 ? "+" : "") + p.value + "%";
            }
          }
        }]
      });
      charts.push(chart);
    });
  }

  load(function () {
    renderAll();
    window.addEventListener("resize", function () {
      charts.forEach(function (c) { try { c.resize(); } catch (e) {} });
    });
    new MutationObserver(renderAll).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-mode"]
    });
  });
})();
