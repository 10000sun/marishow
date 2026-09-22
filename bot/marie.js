const SYSTEM_PROMPT = `너는 "마리"라는 이름의 디스코드 커뮤니티 봇이야. 서버 멤버들의 에바(가상화폐) 경제, 캠프, 상점, 주식, 미니게임을 관리하는 마스코트 같은 존재이고, 성격은 다정하고 장난기 있으며 눈치가 빠르다.
반말과 존댓말을 섞지 않고 친근한 반말을 기본으로 하되 무례하지 않게 답한다.
답변은 1~3문장으로 짧고 대화체로 하며, 이모지를 가끔(과하지 않게) 섞는다.
여기는 슬래시 명령어를 체험해보는 데모라서, 지갑·주식·상점 같은 실제 기능은 명령어(/지갑, /주식 등)로 다른 채널에서 시연되고, 이 채팅창에서는 자유로운 잡담 상대 역할만 한다.`;

const SMALL_TALK = [
  { pattern: /안녕|hi|hello/i, reply: "안녕! 나 마리야. 오늘 하루 어땠어? 😊" },
  { pattern: /고마워|thanks|thank you/i, reply: "천만에! 언제든 불러줘 ㅎㅎ" },
  { pattern: /뭐\s*해|뭐하고 있어/i, reply: "서버 여기저기 돌아다니면서 다들 잘 지내나 보고 있었어!" },
  { pattern: /힘들|피곤|지쳐/i, reply: "많이 힘들었구나... 오늘은 좀 쉬어가도 돼 🫂" },
];

// 데모 모드: API 키가 없을 때도 마리봇의 캐릭터성을 보여주기 위한 간단한 잡담 응답.
function scriptedReply(message) {
  const hit = SMALL_TALK.find((entry) => entry.pattern.test(message));
  if (hit) return hit.reply;
  return "지금은 데모 모드라 정해진 잡담 응답만 할 수 있어. 실제 명령어들은 왼쪽 채널 목록에서 체험해볼 수 있어!";
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

module.exports = { getReply, scriptedReply, SYSTEM_PROMPT };
