(function () {
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("composer");
  const input = document.getElementById("message-input");
  const modeCaption = document.getElementById("mode-caption");

  const history = [];

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
          : "데모 모드예요. !도움말 / !운세 / !칭찬 명령어로 체험해보세요.";
    } catch {
      modeCaption.textContent = "데모 모드예요. !도움말 / !운세 / !칭찬 명령어로 체험해보세요.";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
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

  appendMessage({ who: "marie", text: "안녕! 나 마리야. !도움말이라고 쳐보면 뭘 할 수 있는지 알려줄게 🙂" });
  loadStatus();
})();
