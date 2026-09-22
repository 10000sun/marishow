(function () {
  const messagesEl = document.getElementById("messages");
  const channelListEl = document.getElementById("channel-list");
  const headerTitleEl = document.getElementById("chat-header-title");
  const tickerEl = document.getElementById("stock-ticker");
  const adminToggleInput = document.getElementById("admin-toggle-input");
  const form = document.getElementById("composer");
  const input = document.getElementById("message-input");
  const modeCaption = document.getElementById("mode-caption");
  const hintsEl = document.getElementById("command-hints");

  const chatHistory = []; // AI 잡담 채널 전용 히스토리
  const channelLogs = {}; // channelId -> [{who, kind, text|embed}]
  let currentChannelId = "chat";
  let activeHintIndex = -1;

  function currentChannel() {
    return MariCommands.CHANNELS.find((c) => c.id === currentChannelId);
  }

  function isAdmin() {
    return MariState.get().admin;
  }

  function timeNow() {
    return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  // ---------- 채널 목록 ----------
  function renderChannelList() {
    channelListEl.querySelectorAll(".channel").forEach((el) => el.remove());
    MariCommands.CHANNELS.filter((c) => !c.adminOnly || isAdmin()).forEach((c) => {
      const div = document.createElement("div");
      div.className = `channel${c.id === currentChannelId ? " active" : ""}`;
      div.textContent = `# ${c.name}`;
      div.addEventListener("click", () => switchChannel(c.id));
      channelListEl.appendChild(div);
    });
  }

  function switchChannel(id) {
    const channel = MariCommands.CHANNELS.find((c) => c.id === id);
    if (!channel) return;
    if (channel.adminOnly && !isAdmin()) return;

    currentChannelId = id;
    headerTitleEl.textContent = `# ${channel.name}`;
    input.placeholder = channel.type === "chat" ? "메시지 보내기" : "/ 로 시작하는 명령어를 입력해보세요";
    hintsEl.hidden = true;
    renderChannelList();
    renderTicker();
    renderMessages();

    if (!channelLogs[id] || !channelLogs[id].length) {
      pushLog(id, { who: "marie", kind: "text", text: channel.intro });
    }
  }

  // ---------- 메시지 렌더링 ----------
  function pushLog(channelId, entry) {
    if (!channelLogs[channelId]) channelLogs[channelId] = [];
    channelLogs[channelId].push(entry);
    if (channelId === currentChannelId) renderMessages();
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    const log = channelLogs[currentChannelId] || [];
    log.forEach((entry) => renderEntry(entry));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderEntry(entry) {
    const row = document.createElement("div");
    row.className = "msg";

    const avatar = document.createElement("div");
    avatar.className = `avatar ${entry.who === "marie" ? "marie" : "user"}`;
    avatar.textContent = entry.who === "marie" ? "마리" : "나";

    const body = document.createElement("div");
    body.className = "msg-body";

    const nameLine = document.createElement("div");
    const nameSpan = document.createElement("span");
    nameSpan.className = `msg-name ${entry.who === "marie" ? "marie" : ""}`;
    nameSpan.textContent = entry.who === "marie" ? "마리봇" : "나";
    const timeSpan = document.createElement("span");
    timeSpan.className = "msg-time";
    timeSpan.textContent = entry.time || timeNow();
    nameLine.appendChild(nameSpan);
    nameLine.appendChild(timeSpan);
    body.appendChild(nameLine);

    if (entry.kind === "embed") {
      body.appendChild(buildEmbedCard(entry.embed));
    } else {
      const textEl = document.createElement("div");
      textEl.className = `msg-text${entry.typing ? " typing" : ""}`;
      textEl.textContent = entry.text;
      body.appendChild(textEl);
    }

    row.appendChild(avatar);
    row.appendChild(body);
    messagesEl.appendChild(row);
    return row;
  }

  function buildEmbedCard(embed) {
    const card = document.createElement("div");
    card.className = `embed-card tone-${embed.tone || "default"}`;

    if (embed.title) {
      const title = document.createElement("div");
      title.className = "embed-title";
      title.textContent = embed.title;
      card.appendChild(title);
    }

    (embed.lines || []).forEach((line) => {
      const p = document.createElement("div");
      p.className = "embed-line";
      p.textContent = line;
      card.appendChild(p);
    });

    if (embed.fields && embed.fields.length) {
      const grid = document.createElement("div");
      grid.className = "embed-fields";
      embed.fields.forEach((f) => {
        const field = document.createElement("div");
        field.className = "embed-field";
        const label = document.createElement("div");
        label.className = "embed-field-label";
        label.textContent = f.label;
        const value = document.createElement("div");
        value.className = "embed-field-value";
        value.textContent = f.value;
        field.appendChild(label);
        field.appendChild(value);
        grid.appendChild(field);
      });
      card.appendChild(grid);
    }

    if (embed.footer) {
      const footer = document.createElement("div");
      footer.className = "embed-footer";
      footer.textContent = embed.footer;
      card.appendChild(footer);
    }

    return card;
  }

  // ---------- 주식 티커 ----------
  function renderTicker() {
    if (currentChannelId !== "stock") {
      tickerEl.hidden = true;
      return;
    }
    const s = MariState.get();
    tickerEl.hidden = false;
    tickerEl.innerHTML = "";
    s.stocks.forEach((st) => {
      const diff = st.price - st.prevClose;
      const dir = diff > 0 ? "up" : diff < 0 ? "down" : "";
      const chip = document.createElement("span");
      chip.className = `ticker-chip ${dir}`;
      const pct = st.prevClose ? ((diff / st.prevClose) * 100).toFixed(1) : "0.0";
      chip.textContent = `${st.name} ${st.price.toLocaleString("ko-KR")} (${diff >= 0 ? "+" : ""}${pct}%)`;
      tickerEl.appendChild(chip);
    });
  }

  MariState.onChange(() => {
    renderTicker();
  });

  // ---------- 관리자 토글 ----------
  adminToggleInput.addEventListener("change", () => {
    MariState.get().admin = adminToggleInput.checked;
    if (!MariState.get().admin && currentChannelId === "admin") {
      switchChannel("chat");
      return;
    }
    renderChannelList();
    updateHints();
  });

  // ---------- 명령어 힌트 ----------
  function renderHints(list) {
    hintsEl.innerHTML = "";
    activeHintIndex = list.length ? 0 : -1;

    list.forEach((command, index) => {
      const li = document.createElement("li");
      li.className = `command-hint-item${index === activeHintIndex ? " active" : ""}`;

      const nameEl = document.createElement("span");
      nameEl.className = "command-hint-name";
      nameEl.textContent = command.args ? `${command.name} ${command.args}` : command.name;

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

  function channelCommands() {
    const channel = currentChannel();
    if (channel.type !== "commands") return [];
    return MariCommands.allCommandsFor(channel, isAdmin());
  }

  function updateHints() {
    const value = input.value;
    const commands = channelCommands();
    if (!value.startsWith("/") || !commands.length) {
      hintsEl.hidden = true;
      return;
    }
    const query = value.slice(1).trim();
    const matches = commands.filter((c) => c.name.slice(1).replace(/\s+/g, "").startsWith(query.replace(/\s+/g, "")));
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
      const query = input.value.slice(1).trim().replace(/\s+/g, "");
      const matches = channelCommands().filter((c) => c.name.slice(1).replace(/\s+/g, "").startsWith(query));
      const name = matches[activeHintIndex]?.name;
      if (name) selectCommand(name);
      return;
    } else {
      return;
    }

    items.forEach((item, i) => item.classList.toggle("active", i === activeHintIndex));
  });

  // ---------- 전송 처리 ----------
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      modeCaption.textContent =
        data.mode === "live"
          ? "실시간 AI 응답 모드로 연결되어 있어요."
          : "데모 모드예요. 채널별로 / 명령어를 체험해보세요.";
    } catch {
      modeCaption.textContent = "데모 모드예요. 채널별로 / 명령어를 체험해보세요.";
    }
  }

  async function handleChat(text) {
    pushLog("chat", { who: "user", kind: "text", text });
    chatHistory.push({ role: "user", content: text });

    const typingEntry = { who: "marie", kind: "text", text: "입력 중...", typing: true };
    pushLog("chat", typingEntry);
    const row = messagesEl.lastElementChild;
    const textEl = row.querySelector(".msg-text");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: chatHistory }),
      });
      const data = await res.json();
      const reply = res.ok ? data.reply : data.error || "문제가 생겼어. 잠시 후 다시 시도해줘.";
      textEl.textContent = reply;
      textEl.classList.remove("typing");
      typingEntry.text = reply;
      typingEntry.typing = false;
      chatHistory.push({ role: "assistant", content: reply });
    } catch {
      const fallback = "마리가 지금 답을 못하고 있어. 잠시 후 다시 시도해줘.";
      textEl.textContent = fallback;
      textEl.classList.remove("typing");
      typingEntry.text = fallback;
      typingEntry.typing = false;
    }
  }

  function handleCommandChannel(text, channel) {
    pushLog(channel.id, { who: "user", kind: "text", text });

    if (!text.startsWith("/")) {
      pushLog(channel.id, {
        who: "marie",
        kind: "embed",
        embed: { tone: "error", title: "명령어 전용 채널", lines: ["여긴 명령어 전용 채널이야. /로 시작해봐! (예: " + channel.commands[0].name + ")"] },
      });
      return;
    }

    const result = MariCommands.execute(text, channel, isAdmin());
    pushLog(channel.id, { who: "marie", kind: "embed", embed: result });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    hintsEl.hidden = true;
    input.disabled = true;

    const channel = currentChannel();
    if (channel.type === "chat") {
      handleChat(text).finally(() => {
        input.disabled = false;
        input.focus();
      });
    } else {
      handleCommandChannel(text, channel);
      input.disabled = false;
      input.focus();
    }
  });

  renderChannelList();
  switchChannel("chat");
  loadStatus();
})();
