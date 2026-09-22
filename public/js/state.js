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
      { name: "은하전자", price: 24500, prevClose: 24500 },
      { name: "여백제과", price: 8200, prevClose: 8200 },
      { name: "나래해운", price: 51200, prevClose: 51200 },
      { name: "악동스낵", price: 3100, prevClose: 3100 },
      { name: "마리광산", price: 61800, prevClose: 61800 },
    ],
    portfolio: {}, // name -> qty
    shop: [
      { id: "megaphone", name: "확성기", price: 800, resalePercent: 50, stock: 20, roleItem: false },
      { id: "coupon", name: "교환권", price: 300, resalePercent: 70, stock: 50, roleItem: false },
      { id: "vip", name: "VIP 역할", price: 5000, resalePercent: 0, stock: 5, roleItem: true },
    ],
    inventory: {}, // itemId -> qty
    lottery: { round: 1, ticketPrice: 500, pool: 18500, myTickets: [] },
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

  function tickStocks() {
    state.stocks.forEach((s) => {
      const pct = (Math.random() - 0.48) * 0.04; // 약 -1.9% ~ +2.1% 랜덤워크
      const next = Math.max(100, Math.round(s.price * (1 + pct)));
      s.prevClose = s.price;
      s.price = next;
    });
    notify();
  }

  setInterval(tickStocks, 4000);

  return {
    get: () => state,
    onChange,
    notify,
    addHistory,
    formatEva: (n) => `${n.toLocaleString("ko-KR")} 에바`,
  };
})();
