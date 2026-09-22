// 데모용 가짜 경제 상태. 실제 마리봇처럼 정확한 규칙(개장시간, 세율 등)을 계산하지 않고,
// "값이 실시간으로 바뀐다"는 느낌을 보여주는 데 집중한 목(mock) 데이터.
const MariState = (function () {
  const state = {
    admin: false,
    wallet: { balance: 12000 },
    history: [],
    attendance: { done: false, streak: 3, reward: 200 },
    featureFlags: {
      주식: true,
      상점: true,
      송금: true,
      출석: true,
      생일: true,
      아이디: true,
      위키: true,
      나중에답장: true,
    },
    stocks: [
      { name: "은하전자", price: 24500, prevClose: 24500, open: true, history: [24500] },
      { name: "여백제과", price: 8200, prevClose: 8200, open: true, history: [8200] },
      { name: "나래해운", price: 51200, prevClose: 51200, open: true, history: [51200] },
      { name: "악동스낵", price: 3100, prevClose: 3100, open: true, history: [3100] },
      { name: "마리광산", price: 61800, prevClose: 61800, open: true, history: [61800] },
    ],
    portfolio: {}, // name -> qty
    shop: [
      { id: "megaphone", name: "확성기", price: 800, resalePercent: 50, stock: 20, roleItem: false },
      { id: "coupon", name: "교환권", price: 300, resalePercent: 70, stock: 50, roleItem: false },
      { id: "vip", name: "VIP 역할", price: 5000, resalePercent: 0, stock: 5, roleItem: true },
      { id: "tour", name: "견학권", price: 1200, resalePercent: 0, stock: 10, roleItem: false, tourPass: true },
    ],
    inventory: {}, // itemId -> qty
    lottery: { round: 1, ticketPrice: 500, pool: 18500, myTickets: [] },

    profile: { 닉네임: "체험유저", 레벨: "Lv.7", 캠프: "여백", 업적: "출석왕, 초보 투자자" },
    wiki: { 나: { 좌우명: "오늘도 무사히", 서식지: "지갑 채널", mbti: "ENFP", tmi: "복권을 은근히 자주 삽니다" } },
    birthday: null, // { year, month, day } | null
    registeredIds: { 나: [] }, // 대상 -> [{platform, value}]

    campTax: { rate: 0.1, camp: "여백", paid: false, treasury: 0 },
    tourRequests: [], // { id, camp, date, status }

    up: {
      ranking: [
        { name: "타운가이드", count: 18 },
        { name: "여백이", count: 12 },
        { name: "나", count: 4 },
      ],
      daily: [
        { date: "09/20", entries: ["타운가이드 x2", "여백이 x1"] },
        { date: "09/21", entries: ["나 x1", "타운가이드 x1"] },
      ],
    },

    snoozes: [], // { id, time, memo }
    snoozeSeq: 1,

    memory: [{ id: 1, text: "복권을 자주 사는 편" }],
    memorySeq: 2,

    evashi: { lastClaim: 0 },

    roster: [
      { name: "체험유저(나)", camp: "여백", role: "일반 멤버" },
      { name: "타운가이드", camp: "-", role: "타운가이드" },
      { name: "여백이", camp: "여백", role: "캠프장" },
      { name: "악동왕", camp: "악동", role: "캠프장" },
    ],
    grantedRoles: [],
    auditLog: [],
    chronicle: [],

    listeners: [],
  };

  function notify() {
    state.listeners.forEach((fn) => fn(state));
  }

  function onChange(fn) {
    state.listeners.push(fn);
  }

  function addHistory(type, amount, memo) {
    state.history.unshift({ type, amount, memo, ts: Date.now() });
    if (state.history.length > 50) state.history.pop();
  }

  function addAudit(text) {
    state.auditLog.unshift({ text, ts: Date.now() });
    if (state.auditLog.length > 30) state.auditLog.pop();
  }

  function tickStocks() {
    state.stocks.forEach((s) => {
      if (!s.open) return;
      const pct = (Math.random() - 0.48) * 0.04; // 약 -1.9% ~ +2.1% 랜덤워크
      const next = Math.max(100, Math.round(s.price * (1 + pct)));
      s.prevClose = s.price;
      s.price = next;
      s.history.push(next);
      if (s.history.length > 40) s.history.shift();
    });
    notify();
  }

  setInterval(tickStocks, 4000);

  return {
    get: () => state,
    onChange,
    notify,
    addHistory,
    addAudit,
    formatEva: (n) => `${n.toLocaleString("ko-KR")} 에바`,
  };
})();
