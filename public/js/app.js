(function () {
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("composer");
  const input = document.getElementById("message-input");
  const modeCaption = document.getElementById("mode-caption");
  const hintsEl = document.getElementById("command-hints");

  const history = [];
  let commands = [];
  let activeHintIndex = -1;

  function timeNow() {
    return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  function appendMessage({ who, text, typing }) {
    const row = document.createElement("div");
    row.className = "msg";

    const avatar = document.createElement("div");
    avatar.className = `avatar ${who === "marie" ? "marie" : "user"}`;
    avatar.textContent = who === "marie" ? "마리" : "나";

    const body = document.createElement("div");
    body.className = "msg-body";

    const nameLine = document.createElement("div");
    const nameSpan = document.createElement("span");
    nameSpan.className = `msg-name ${who === "marie" ? "marie" : ""}`;
    nameSpan.textContent = who === "marie" ? "마리봇" : "나";
    const timeSpan = document.createElement("span");
    timeSpan.className = "msg-time";
    timeSpan.textContent = timeNow();
    nameLine.appendChild(nameSpan);
    nameLine.appendChild(timeSpan);

    const textEl = document.createElement("div");
    textEl.className = `msg-text${typing ? " typing" : ""}`;
    textEl.textContent = text;

    body.appendChild(nameLine);
    body.appendChild(textEl);
    row.appendChild(avatar);
    row.appendChild(body);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return textEl;
  }

  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      modeCaption.textContent =
        data.mode === "live"
          ? "실시간 AI 응답 모드로 연결되어 있어요."
          : "데모 모드예요. /를 입력하면 사용 가능한 명령어를 볼 수 있어요.";
    } catch {
      modeCaption.textContent = "데모 모드예요. /를 입력하면 사용 가능한 명령어를 볼 수 있어요.";
    }
  }

  async function loadCommands() {
    try {
      const res = await fetch("/api/commands");
      const data = await res.json();
      commands = Array.isArray(data.commands) ? data.commands : [];
    } catch {
      commands = [];
    }
  }

  function renderHints(list) {
    hintsEl.innerHTML = "";
    activeHintIndex = list.length ? 0 : -1;

    list.forEach((command, index) => {
      const li = document.createElement("li");
      li.className = `command-hint-item${index === activeHintIndex ? " active" : ""}`;

      const nameEl = document.createElement("span");
      nameEl.className = "command-hint-name";
      nameEl.textContent = command.name;

      const descEl = document.createElement("span");
      descEl.className = "command-hint-desc";
      descEl.textContent = command.description;

      li.appendChild(nameEl);
      li.appendChild(descEl);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectCommand(command.name);
      });

      hintsEl.appendChild(li);
    });

    hintsEl.hidden = list.length === 0;
  }

  function selectCommand(name) {
    input.value = `${name} `;
    hintsEl.hidden = true;
    input.focus();
  }

  function updateHints() {
    const value = input.value;
    if (!value.startsWith("/")) {
      hintsEl.hidden = true;
      return;
    }

    const query = value.slice(1).trim();
    const matches = commands.filter((c) => c.name.slice(1).startsWith(query));
    renderHints(matches);
  }

  input.addEventListener("input", updateHints);

  input.addEventListener("keydown", (e) => {
    if (hintsEl.hidden) return;
    const items = Array.from(hintsEl.children);
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeHintIndex = (activeHintIndex + 1) % items.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeHintIndex = (activeHintIndex - 1 + items.length) % items.length;
    } else if (e.key === "Escape") {
      hintsEl.hidden = true;
      return;
    } else if (e.key === "Tab" || (e.key === "Enter" && activeHintIndex >= 0)) {
      e.preventDefault();
      const name = commands.filter((c) => c.name.slice(1).startsWith(input.value.slice(1).trim()))[
        activeHintIndex
      ]?.name;
      if (name) selectCommand(name);
      return;
    } else {
      return;
    }

    items.forEach((item, i) => item.classList.toggle("active", i === activeHintIndex));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    hintsEl.hidden = true;
    input.disabled = true;
    appendMessage({ who: "user", text });
    history.push({ role: "user", content: text });

    const typingEl = appendMessage({ who: "marie", text: "입력 중...", typing: true });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      const reply = res.ok ? data.reply : data.error || "문제가 생겼어. 잠시 후 다시 시도해줘.";
      typingEl.textContent = reply;
      typingEl.classList.remove("typing");
      history.push({ role: "assistant", content: reply });
    } catch {
      typingEl.textContent = "마리가 지금 답을 못하고 있어. 잠시 후 다시 시도해줘.";
      typingEl.classList.remove("typing");
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  appendMessage({ who: "marie", text: "안녕! 나 마리야. /를 입력하면 뭘 할 수 있는지 알려줄게 🙂" });
  loadStatus();
  loadCommands();
})();
