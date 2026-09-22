const SYSTEM_PROMPT = `너는 "마리"라는 이름의 디스코드 봇이야. 성격은 다정하고 장난기 있으며 눈치가 빠른 친구 같은 말투를 쓴다.
반말과 존댓말을 섞지 않고 친근한 반말을 기본으로 하되 무례하지 않게 답한다.
답변은 1~3문장으로 짧고 대화체로 하며, 이모지를 가끔(과하지 않게) 섞는다.
사용자가 /도움말, /운세, /칭찬 같은 명령어를 언급하면 그 명령어를 실제로 수행하듯 답한다.`;

const COMMANDS = [
  { name: "/안녕", description: "마리에게 인사하기" },
  { name: "/운세", description: "오늘의 운세 보기" },
  { name: "/칭찬", description: "힘이 되는 칭찬 받기" },
  { name: "/도움말", description: "사용 가능한 명령어 보기" },
];

const FORTUNES = [
  "오늘은 잃어버린 물건을 찾게 될 운이야. 주머니부터 확인해봐!",
  "새로운 일을 시작하기 딱 좋은 날! 미루지 말고 지금 해봐.",
  "사람 때문에 스트레스 받을 수 있는 날이니 한 박자 쉬어가.",
  "생각지도 못한 곳에서 좋은 소식이 올 예감이야.",
  "오늘은 무리하지 말고 컨디션 관리에 집중하는 게 좋겠어.",
];

const COMPLIMENTS = [
  "오늘도 여기까지 온 것만으로도 잘하고 있는 거야!",
  "너 은근히 센스 있다? 알아채는 사람만 아는 매력.",
  "꾸준히 하는 거 자체가 재능이야. 진짜로.",
  "지금 이 순간에도 성장하고 있는 중이라니까.",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 데모 모드: API 키가 없을 때도 마리봇의 캐릭터성을 보여주기 위한 규칙 기반 응답.
function scriptedReply(message) {
  const text = message.trim();

  if (text === "/도움말" || /도움말|명령어|help/i.test(text)) {
    return "내가 할 수 있는 건 /안녕, /운세, /칭찬, 그리고 그냥 편하게 말 거는 잡담이야. 뭐부터 해볼래? 🙂";
  }
  if (text === "/운세" || text.includes("운세")) {
    return pick(FORTUNES);
  }
  if (text === "/칭찬" || text.includes("칭찬")) {
    return pick(COMPLIMENTS);
  }
  if (text === "/안녕" || /안녕|hi|hello/i.test(text)) {
    return "안녕! 나 마리야. 오늘 하루 어땠어? 😊";
  }
  if (/고마워|thanks|thank you/i.test(text)) {
    return "천만에! 언제든 불러줘 ㅎㅎ";
  }
  return "지금은 데모 모드라 정해진 답변만 할 수 있어. /도움말, /운세, /칭찬 중에 골라볼래?";
}

async function getReply({ message, history = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { reply: scriptedReply(message), mode: "demo" };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  const reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return { reply, mode: "live" };
}

module.exports = { getReply, scriptedReply, SYSTEM_PROMPT, COMMANDS };
