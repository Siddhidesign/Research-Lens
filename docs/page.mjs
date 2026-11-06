
const themes = [...new Set(REPO.sessions.flatMap(s => s.excerpts.map(e => e.theme)))].sort();

const SPEC = [
  {
    name: "search_transcripts",
    desc: "Where was this mentioned, by whom, when",
    fields: [{ key: "query", type: "text", label: "query", value: "rent" }],
  },
  {
    name: "quotes_by_theme",
    desc: "Every quote on this theme, grouped by sentiment",
    fields: [
      { key: "theme", type: "select", label: "theme", options: themes, value: "trust" },
      { key: "round", type: "select", label: "round", options: ["all", "1", "2"], value: "all" },
    ],
  },
  {
    name: "pattern_frequency",
    desc: "Is this a pattern, or one loud participant",
    fields: [],
  },
  {
    name: "compare_rounds",
    desc: "Did the design change actually work",
    fields: [{ key: "theme", type: "select", label: "theme", options: themes, value: "trust" }],
  },
  {
    name: "draft_findings",
    desc: "Evidence skeleton with citations, plus what the data does not support",
    fields: [{ key: "theme", type: "select", label: "theme", options: themes, value: "control" }],
  },
];

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const host = document.getElementById("tools");

SPEC.forEach((spec, i) => {
  const el = document.createElement("div");
  el.className = "tool";
  el.dataset.open = i === 0 ? "true" : "false";

  const fieldsHtml = spec.fields.map(f => {
    if (f.type === "select") {
      const opts = f.options.map(o =>
        `<option value="${esc(o)}"${o === f.value ? " selected" : ""}>${esc(o)}</option>`
      ).join("");
      return `<div><label for="${spec.name}-${f.key}">${esc(f.label)}</label>
        <select id="${spec.name}-${f.key}" data-key="${f.key}">${opts}</select></div>`;
    }
    return `<div><label for="${spec.name}-${f.key}">${esc(f.label)}</label>
      <input type="text" id="${spec.name}-${f.key}" data-key="${f.key}" value="${esc(f.value)}"></div>`;
  }).join("");

  el.innerHTML = `
    <button class="head" aria-expanded="${i === 0}" aria-controls="${spec.name}-body">
      <span class="tname">${spec.name}</span>
      <span class="tdesc">${esc(spec.desc)}</span>
      <span class="chev" aria-hidden="true">›</span>
    </button>
    <div class="body" id="${spec.name}-body">
      <div class="controls">
        ${fieldsHtml}
        <button class="run" type="button">Run</button>
      </div>
      <p class="label">The call an assistant makes</p>
      <div class="call"></div>
      <p class="label">What it gets back</p>
      <pre class="out" tabindex="0" aria-live="polite"></pre>
    </div>`;

  const head = el.querySelector(".head");
  head.addEventListener("click", () => {
    const open = el.dataset.open === "true";
    el.dataset.open = String(!open);
    head.setAttribute("aria-expanded", String(!open));
  });

  const readArgs = () => {
    const args = {};
    el.querySelectorAll("[data-key]").forEach(node => {
      const k = node.dataset.key;
      let v = node.value;
      if (k === "round") {
        if (v === "all") return;
        args[k] = Number(v);
        return;
      }
      args[k] = v;
    });
    return args;
  };

  const run = () => {
    const args = readArgs();
    const callEl = el.querySelector(".call");
    const outEl = el.querySelector(".out");
    const argStr = Object.keys(args).length
      ? JSON.stringify(args, null, 2).replace(/^/gm, "  ").trim()
      : "{}";
    callEl.innerHTML =
      `<span class="k">tool:</span> <span class="v">${esc(spec.name)}</span>\n` +
      `<span class="k">arguments:</span> ${esc(argStr)}`;
    try {
      outEl.textContent = TOOLS[spec.name](REPO, args);
    } catch (err) {
      outEl.textContent = "Error: " + err.message;
    }
  };

  el.querySelector(".run").addEventListener("click", run);
  el.querySelectorAll("input[type=text]").forEach(inp =>
    inp.addEventListener("keydown", e => { if (e.key === "Enter") run(); })
  );

  host.appendChild(el);
  run();
});

const study = REPO.study;
document.getElementById("meta").innerHTML = [
  ["Study", study.name],
  ["IRB protocol", study.irb],
  ["Sessions in this demo", REPO.sessions.length],
  ["Rounds", study.rounds],
  ["Participants in the full study", study.participants],
  ["Themes tagged", themes.join(", ")],
].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");