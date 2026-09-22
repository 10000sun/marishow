// 채널별 슬래시 명령어 정의. 실제 마리봇의 명령어 체계(mari/인수인계서_일반유저_명령어.md,
// 10000sun/maribot 기준)를 빠짐없이 반영하되, 백엔드 DB 없이 브라우저 세션 안에서만 도는
// 목(mock) 경제로 동작한다. 관리자 전용 명령어는 모두 "관리자-전용" 채널에 몰아두고,
// 우측 상단 토글로 그 채널 자체의 노출 여부를 제어한다.
const MariCommands = (function () {
  const S = MariState;

  function embed(tone, title, lines, fields, footer) {
    return { tone, title, lines: lines || [], fields: fields || [], footer };
  }

  function errorEmbed(text) {
    return embed("error", "실행할 수 없어요", [text]);
  }

  function needFeature(name) {
    const s = S.get();
    if (!s.featureFlags[name]) {
      return errorEmbed(`"${name}" 기능은 관리자가 지금 정지해뒀어. #관리자-전용에서 다시 켤 수 있어.`);
    }
    return null;
  }

  function sparkline(values) {
    const chars = "▁▂▃▄▅▆▇█";
    if (!values || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values
      .map((v) => chars[Math.min(chars.length - 1, Math.floor(((v - min) / range) * (chars.length - 1)))])
      .join("");
  }

  const PLATFORM_ALIASES = {
    롤: "Riot", 발로: "Riot", 라이엇: "Riot",
    옵치: "Battle.net", 배틀넷: "Battle.net", 블리자드: "Battle.net",
    스팀: "Steam", 인스타: "Instagram", 레식: "유비소프트", 유비: "유비소프트",
    계좌: "계좌", 전번: "전번",
  };

  // ============ 지갑 · 경제 ============
  const walletCommands = [
    {
      name: "/지갑",
      args: "[member]",
      description: "내 에바 잔고와 인벤토리 보기 (member는 상점주인·관리자 전용)",
      run(args, ctx) {
        const s = S.get();
        const target = args[0];

        if (target && target !== "나") {
          if (!ctx.admin) return errorEmbed("남의 지갑을 보는 건 상점주인·관리자만 할 수 있어. 관리자 모드를 켜줘.");
          const u = s.users[target];
          if (!u) return errorEmbed(`"${target}"을(를) 찾을 수 없어요. 유저1, 유저2, 유저3 중에서 골라봐.`);
          const items = Object.entries(u.inventory)
            .filter(([, qty]) => qty > 0)
            .map(([id, qty]) => {
              const item = s.shop.find((i) => i.id === id);
              return `${item ? item.name : id} x${qty}`;
            });
          return embed(
            "default",
            `💳 지갑 · ${target}`,
            [`잔고: ${S.formatEva(u.wallet)}`],
            [{ label: "인벤토리", value: items.length ? items.join(", ") : "없음" }],
            "관리자 조회 · 채널에 공개되는 정보입니다"
          );
        }

        const items = Object.entries(s.inventory)
          .filter(([, qty]) => qty > 0)
          .map(([id, qty]) => {
            const item = s.shop.find((i) => i.id === id);
            return `${item ? item.name : id} x${qty}`;
          });
        return embed(
          "default",
          "💳 지갑",
          [`잔고: ${S.formatEva(s.wallet.balance)}`],
          [{ label: "인벤토리", value: items.length ? items.join(", ") : "없음" }],
          "채널에 공개되는 정보입니다"
        );
      },
    },
    {
      name: "/지갑내역 조회",
      args: "[개수]",
      description: "최근 입출금 내역 보기",
      run(args) {
        const s = S.get();
        const n = Math.min(50, Number(args[0]) || 10);
        if (!s.history.length) return embed("default", "📜 지갑내역", ["아직 거래 내역이 없어."]);
        const lines = s.history.slice(0, n).map((h) => {
          const sign = h.amount >= 0 ? "+" : "";
          return `${sign}${h.amount.toLocaleString("ko-KR")} 에바 · ${h.memo}`;
        });
        return embed("default", `📜 지갑내역 (최근 ${lines.length}건, 나만 보임)`, lines);
      },
    },
    {
      name: "/송금",
      args: "대상 금액",
      description: "다른 멤버에게 에바 보내기",
      run(args) {
        const blocked = needFeature("송금");
        if (blocked) return blocked;
        const [target, amountStr] = args;
        const amount = Number(amountStr);
        if (!target || !Number.isFinite(amount) || amount <= 0) {
          return errorEmbed("사용법: /송금 대상 금액  (예: /송금 유저1 500)");
        }
        const s = S.get();
        if (s.wallet.balance < 0) return errorEmbed("잔고가 마이너스라 송금이 막혀 있어.");
        if (amount > s.wallet.balance) return errorEmbed(`잔고가 부족해. 지금 잔고는 ${S.formatEva(s.wallet.balance)}야.`);
        s.wallet.balance -= amount;
        S.addHistory("송금", -amount, `${target}에게 송금`);
        S.notify();
        return embed("default", "💸 송금 완료", [`${target}님에게 ${S.formatEva(amount)}를 보냈어요.`]);
      },
    },
    {
      name: "/출석",
      description: "하루 한 번 출석 체크",
      run() {
        const blocked = needFeature("출석");
        if (blocked) return blocked;
        const s = S.get();
        if (s.attendance.done) return errorEmbed("오늘은 이미 출석했어! (데모에서는 세션당 1회)");
        s.attendance.done = true;
        s.attendance.streak += 1;
        s.wallet.balance += s.attendance.reward;
        S.addHistory("출석", s.attendance.reward, "출석 보상");
        S.notify();
        return embed("default", "🌞 출석 완료", [`오늘 출석 ${s.attendance.streak}일째! ${S.formatEva(s.attendance.reward)}를 받았어요.`]);
      },
    },
    {
      name: "/캠프 세금조회",
      description: "이번 회차 세금 조회 (나만 보임)",
      run() {
        const s = S.get();
        const tax = Math.max(0, Math.round(s.wallet.balance * s.campTax.rate));
        return embed(
          "default",
          "🏦 캠프 세금 조회",
          [`소속 캠프: ${s.campTax.camp}`, `예상 세액: ${S.formatEva(tax)}`, s.campTax.paid ? "✅ 이번 회차 이미 납부함" : "❌ 아직 미납"],
          [],
          "/캠프 세금납부 로 바로 낼 수 있어요"
        );
      },
    },
    {
      name: "/캠프 세금납부",
      description: "조회된 세금을 자진 납부",
      run() {
        const s = S.get();
        if (s.campTax.paid) return errorEmbed("이번 회차는 이미 납부했어.");
        const tax = Math.max(0, Math.round(s.wallet.balance * s.campTax.rate));
        s.wallet.balance -= tax;
        s.campTax.paid = true;
        s.campTax.treasury += tax;
        S.addHistory("캠프통장 후원", -tax, `${s.campTax.camp} 캠프 세금 납부`);
        S.notify();
        return embed("default", "🏦 세금 납부 완료", [`${S.formatEva(tax)}를 ${s.campTax.camp} 캠프 통장에 냈어요.`]);
      },
    },
  ];

  // ============ 주식 ============
  function stockLine(st) {
    const diff = st.price - st.prevClose;
    const pct = st.prevClose ? ((diff / st.prevClose) * 100).toFixed(2) : "0.00";
    const arrow = diff > 0 ? "🔺" : diff < 0 ? "🔻" : "▪";
    return `${arrow} ${st.name}${st.open ? "" : " (폐장)"}: ${st.price.toLocaleString("ko-KR")} (${diff >= 0 ? "+" : ""}${pct}%)`;
  }

  const stockCommands = [
    {
      name: "/주식 목록",
      description: "상장 종목 시세 보기",
      run() {
        const s = S.get();
        return embed("default", "📈 주식 목록 (4초마다 시세 변동)", s.stocks.map(stockLine));
      },
    },
    {
      name: "/주식 매수",
      args: "종목 수량",
      description: "주식 사기",
      run(args) {
        const blocked = needFeature("주식");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        if (!stock || !Number.isFinite(qty) || qty <= 0) return errorEmbed("사용법: /주식 매수 종목 수량  (예: /주식 매수 은하전자 5)");
        if (!stock.open) return errorEmbed("지금은 폐장 시간이야. 관리자가 개장하면 다시 시도해줘.");
        const cost = stock.price * qty;
        if (cost > s.wallet.balance) return errorEmbed(`잔고가 부족해. 필요 금액 ${S.formatEva(cost)}, 보유 ${S.formatEva(s.wallet.balance)}`);
        s.wallet.balance -= cost;
        s.portfolio[name] = (s.portfolio[name] || 0) + qty;
        S.addHistory("주식 매수", -cost, `${name} ${qty}주 매수`);
        S.notify();
        return embed("default", "📥 매수 완료", [`${name} ${qty}주를 ${S.formatEva(cost)}에 샀어요.`]);
      },
    },
    {
      name: "/주식 매도",
      args: "종목 수량",
      description: "주식 팔기",
      run(args) {
        const blocked = needFeature("주식");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        const holding = s.portfolio[name] || 0;
        if (!stock || !Number.isFinite(qty) || qty <= 0) return errorEmbed("사용법: /주식 매도 종목 수량");
        if (!stock.open) return errorEmbed("지금은 폐장 시간이야. 관리자가 개장하면 다시 시도해줘.");
        if (qty > holding) return errorEmbed(`보유 수량이 부족해. 지금 ${name} ${holding}주 보유 중.`);
        const proceeds = stock.price * qty;
        s.wallet.balance += proceeds;
        s.portfolio[name] = holding - qty;
        S.addHistory("주식 매도", proceeds, `${name} ${qty}주 매도`);
        S.notify();
        return embed("default", "📤 매도 완료", [`${name} ${qty}주를 ${S.formatEva(proceeds)}에 팔았어요.`]);
      },
    },
    {
      name: "/주식 포폴",
      args: "[member]",
      description: "포트폴리오 보기 (member는 상점주인·관리자 전용)",
      run(args, ctx) {
        const s = S.get();
        const target = args[0];
        let portfolio = s.portfolio;
        let label = "📊 포트폴리오 (나만 보임)";

        if (target && target !== "나") {
          if (!ctx.admin) return errorEmbed("남의 포트폴리오는 관리자·상점주인만 볼 수 있어. 관리자 모드를 켜줘.");
          const u = s.users[target];
          if (!u) return errorEmbed(`"${target}"을(를) 찾을 수 없어요. 유저1, 유저2, 유저3 중에서 골라봐.`);
          portfolio = u.portfolio;
          label = `📊 포트폴리오 · ${target} (관리자 조회)`;
        }

        const rows = Object.entries(portfolio).filter(([, qty]) => qty > 0);
        if (!rows.length) return embed("default", "📊 포트폴리오", ["보유 중인 종목이 없어요."]);
        let total = 0;
        const lines = rows.map(([name, qty]) => {
          const stock = s.stocks.find((st) => st.name === name);
          const value = stock ? stock.price * qty : 0;
          total += value;
          return `${name} ${qty}주 · 평가액 ${value.toLocaleString("ko-KR")} 에바`;
        });
        lines.push(`총 평가액: ${S.formatEva(total)}`);
        return embed("default", label, lines);
      },
    },
    {
      name: "/주식 그래프",
      args: "종목명",
      description: "최근 가격 추이 보기",
      run(args) {
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === args[0]);
        if (!stock) return errorEmbed("사용법: /주식 그래프 종목명");
        if ((stock.closings || 0) < 2) return errorEmbed("종가게시가 2번 이상 있어야 그래프를 그릴 수 있어요. 갓 상장된 종목이에요.");
        const graph = sparkline(stock.history);
        return embed("default", `📉 ${stock.name} 가격 추이`, [graph, `현재가: ${stock.price.toLocaleString("ko-KR")} 에바`]);
      },
    },
  ];

  // ============ 상점 ============
  const shopCommands = [
    {
      name: "/상점 목록",
      description: "매대 상품 보기",
      run() {
        const s = S.get();
        return embed(
          "default",
          "🛒 매대 목록",
          s.shop.map(
            (item) =>
              `${item.name} · ${item.price.toLocaleString("ko-KR")} 에바 · 재고 ${item.stock} · 되팔기 ${item.resalePercent}%${
                item.roleItem ? " · 역할 아이템" : item.tourPass ? " · 견학권" : ""
              }`
          )
        );
      },
    },
    {
      name: "/상점 구매",
      args: "아이템 수량",
      description: "매대에서 아이템 구매",
      run(args) {
        const blocked = needFeature("상점");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr) || 1;
        const s = S.get();
        const item = s.shop.find((i) => i.name === name);
        if (!item) return errorEmbed("사용법: /상점 구매 아이템 수량  (예: /상점 구매 확성기 1)");
        if (item.stock < qty) return errorEmbed(`재고가 부족해요. 남은 재고 ${item.stock}개.`);
        const cost = item.price * qty;
        if (cost > s.wallet.balance) return errorEmbed(`잔고가 부족해. 필요 금액 ${S.formatEva(cost)}`);
        if (item.roleItem && (s.inventory[item.id] || 0) > 0) return errorEmbed("이미 가진 역할 아이템은 중복 구매할 수 없어요.");
        s.wallet.balance -= cost;
        item.stock -= qty;
        s.inventory[item.id] = (s.inventory[item.id] || 0) + qty;
        S.addHistory("상점 구매", -cost, `${item.name} x${qty} 구매`);
        S.notify();
        return embed("default", "🛍 구매 완료", [`${item.name} ${qty}개를 ${S.formatEva(cost)}에 샀어요.`]);
      },
    },
    {
      name: "/상점 되팔기",
      args: "아이템 수량",
      description: "산 아이템 되팔기",
      run(args) {
        const blocked = needFeature("상점");
        if (blocked) return blocked;
        const [name, qtyStr] = args;
        const qty = Number(qtyStr) || 1;
        const s = S.get();
        const item = s.shop.find((i) => i.name === name);
        if (!item) return errorEmbed("사용법: /상점 되팔기 아이템 수량");
        const owned = s.inventory[item.id] || 0;
        if (owned < qty) return errorEmbed(`보유 수량이 부족해요. 지금 ${owned}개 보유 중.`);
        const refund = Math.round(item.price * qty * (item.resalePercent / 100));
        s.wallet.balance += refund;
        item.stock += qty;
        s.inventory[item.id] = owned - qty;
        S.addHistory("상점 되팔기", refund, `${item.name} x${qty} 되팔기`);
        S.notify();
        return embed("default", "♻️ 되팔기 완료", [`${item.name} ${qty}개를 되팔아 ${S.formatEva(refund)}를 받았어요.`]);
      },
    },
    {
      name: "/상점 선물",
      args: "아이템 대상",
      description: "가진 아이템을 다른 멤버에게 선물",
      run(args) {
        const blocked = needFeature("상점");
        if (blocked) return blocked;
        const [name, target] = args;
        const s = S.get();
        const item = s.shop.find((i) => i.name === name);
        if (!item || !target) return errorEmbed("사용법: /상점 선물 아이템 대상");
        if (item.roleItem) return errorEmbed("역할이 지급되는 아이템은 선물할 수 없어요.");
        const owned = s.inventory[item.id] || 0;
        if (owned < 1) return errorEmbed(`"${item.name}"을(를) 갖고 있지 않아요.`);
        s.inventory[item.id] = owned - 1;
        S.notify();
        return embed("default", "🎁 선물 완료", [`${target}님에게 ${item.name}을(를) 선물했어요.`]);
      },
    },
    {
      name: "/견학 신청",
      args: "캠프 날짜",
      description: "견학권으로 견학 신청하기",
      run(args) {
        const s = S.get();
        const owned = s.inventory.tour || 0;
        if (owned < 1) return errorEmbed("먼저 매대에서 견학권을 구매해줘. (/상점 구매 견학권 1)");
        const [camp, ...rest] = args;
        if (!camp) return errorEmbed("사용법: /견학 신청 캠프 날짜  (예: /견학 신청 여백 이번주 토요일)");
        s.inventory.tour = owned - 1;
        const request = { id: s.tourSeq || 1, camp, date: rest.join(" ") || "되도록 빨리", status: "대기" };
        s.tourSeq = request.id + 1;
        s.tourRequests.push(request);
        S.notify();
        return embed(
          "default",
          "🎫 견학 신청 접수",
          [`캠프: ${camp}`, `희망 일정: ${request.date}`, `신청번호: #${request.id}`],
          [],
          "상점 로그로 전달됐어요. 상점주인이 곧 /견학 보내기로 태워줄 거예요"
        );
      },
    },
  ];

  // ============ 복권 ============
  const lotteryCommands = [
    {
      name: "/복권 구매",
      args: "장수 번호1 번호2 번호3 번호4",
      description: "같은 번호로 장수만큼 복권 구매 (모두같게 모드)",
      run(args) {
        const s = S.get();
        const count = Number(args[0]);
        const nums = args.slice(1, 5);
        if (!Number.isFinite(count) || count <= 0 || nums.length < 4) {
          return errorEmbed("사용법: /복권 구매 장수 번호1 번호2 번호3 번호4  (예: /복권 구매 3 5 12 28 41)");
        }
        if (count > 500) return errorEmbed("한 번에 최대 500장까지 살 수 있어요.");
        const total = s.lottery.ticketPrice * count;
        if (total > s.wallet.balance) return errorEmbed(`잔고가 부족해요. 필요 금액 ${S.formatEva(total)}`);
        s.wallet.balance -= total;
        s.lottery.pool += total;
        for (let i = 0; i < count; i += 1) s.lottery.myTickets.push(nums);
        S.addHistory("복권 구매", -total, `복권 ${count}장 구매`);
        S.notify();
        return embed("default", "🎟 복권 구매 완료", [`번호 [${nums.join(", ")}]로 ${count}장 샀어요.`]);
      },
    },
    {
      name: "/복권 목록",
      description: "내가 산 번호 보기",
      run() {
        const s = S.get();
        if (!s.lottery.myTickets.length) return embed("default", "🎟 내 복권", ["이번 회차에 산 복권이 없어요."]);
        const lines = s.lottery.myTickets.map((t, i) => `#${i + 1}: ${t.join(", ")}`);
        return embed("default", `🎟 내 복권 (${s.lottery.round}회차)`, lines);
      },
    },
    {
      name: "/복권 회차",
      description: "이번 회차 현황 보기",
      run() {
        const s = S.get();
        return embed("default", `🎰 ${s.lottery.round}회차 현황`, [
          `누적 판매액: ${S.formatEva(s.lottery.pool)}`,
          `티켓 가격: ${S.formatEva(s.lottery.ticketPrice)}`,
          `내 보유 티켓: ${s.lottery.myTickets.length}장`,
        ]);
      },
    },
    {
      name: "/복권 당첨확인",
      description: "지금 바로 추첨 결과 확인 (데모 전용 즉시 추첨)",
      run() {
        const s = S.get();
        if (!s.lottery.myTickets.length) return errorEmbed("보유한 복권이 없어요. 먼저 구매해봐!");
        const matches = s.lottery.myTickets.map((t) => t.filter(() => Math.random() < 0.25).length);
        const best = Math.max(...matches);
        let prize = 0;
        let rank = "낙첨";
        if (best >= 4) { prize = Math.round(s.lottery.pool * 0.5); rank = "1등"; }
        else if (best === 3) { prize = Math.round(s.lottery.pool * 0.3); rank = "2등"; }
        else if (best === 2) { prize = Math.round(s.lottery.pool * 0.15); rank = "3등"; }
        if (prize > 0) {
          s.wallet.balance += prize;
          S.addHistory("복권 당첨", prize, `${s.lottery.round}회차 ${rank}`);
        }
        s.lottery.round += 1;
        s.lottery.pool = Math.round(s.lottery.pool * 0.1);
        s.lottery.myTickets = [];
        S.notify();
        return embed(
          prize > 0 ? "default" : "error",
          prize > 0 ? `🎉 ${rank} 당첨!` : "😢 낙첨",
          [prize > 0 ? `${S.formatEva(prize)}를 받았어요! 다음 회차가 시작됐어요.` : "다음 회차에 다시 도전해봐요."]
        );
      },
    },
  ];

  // ============ 미니게임 ============
  const hiLow = { open: false, current: null };
  const leaderboard = [
    { name: "유저2", wins: 12 },
    { name: "유저1", wins: 9 },
    { name: "유저3", wins: 7 },
  ];

  function resolveHiLow(pick) {
    if (!hiLow.open) return errorEmbed("먼저 /하이로우로 판을 열어야 해!");
    const next = 1 + Math.floor(Math.random() * 100);
    const won = pick === "high" ? next > hiLow.current : next < hiLow.current;
    const prev = hiLow.current;
    hiLow.open = false;
    if (won) {
      let me = leaderboard.find((r) => r.name === "나");
      if (!me) { me = { name: "나", wins: 0 }; leaderboard.push(me); }
      me.wins += 1;
    }
    return embed(won ? "default" : "error", won ? "🎉 성공!" : "😢 실패", [`이전 숫자 ${prev} → 다음 숫자 ${next}. ${won ? "맞혔어요!" : "다음 기회에!"}`]);
  }

  const minigameCommands = [
    {
      name: "/하이로우",
      description: "하이로우 판 열기",
      run() {
        hiLow.open = true;
        hiLow.current = 1 + Math.floor(Math.random() * 100);
        return embed("default", "🎲 하이로우 시작", [`현재 숫자: ${hiLow.current}`, "다음 숫자가 더 높을지 낮을지 /하이 또는 /로우로 맞혀봐!"]);
      },
    },
    { name: "/하이", description: "다음 숫자가 더 높다에 베팅", run: () => resolveHiLow("high") },
    { name: "/로우", description: "다음 숫자가 더 낮다에 베팅", run: () => resolveHiLow("low") },
    {
      name: "/고확",
      args: "내용",
      description: "확성기 1개를 소모해 크게 방송하기",
      run(args) {
        const s = S.get();
        const owned = s.inventory.megaphone || 0;
        if (owned < 1) return errorEmbed("인벤토리에 확성기가 없어요. 상점에서 먼저 구매해줘.");
        if (!args.length) return errorEmbed("사용법: /고확 내용");
        s.inventory.megaphone = owned - 1;
        S.notify();
        return embed("default", "📣 " + args.join(" ").toUpperCase(), [], [], "확성기 1개를 소모했어요");
      },
    },
    {
      name: "/미니게임 목록",
      description: "브라우저 미니게임 목록 (나만 보임)",
      run() {
        return embed(
          "default",
          "🕹 미니게임 목록",
          ["🏃 므에옹 피하기 — 개인 링크 7일 유효 (에바 보상 없음)", "📓 돌이킬 수 없는 — 개인 링크 1시간 유효 (한 번 입장하면 30일 유지)"],
          [],
          "링크에 본인 표가 들어있어요. 남에게 넘기면 그 사람이 내 이름으로 기록됩니다"
        );
      },
    },
    {
      name: "/미니게임 랭킹",
      description: "미니게임 랭킹 보기",
      run() {
        const lines = leaderboard.slice().sort((a, b) => b.wins - a.wins).map((row, i) => `${i + 1}위 ${row.name} — ${row.wins}승`);
        return embed("default", "🏆 미니게임 랭킹", lines);
      },
    },
  ];

  // ============ 프로필 · 위키 · 생일 · 아이디 ============
  const profileCommands = [
    {
      name: "/프로필",
      args: "[유저]",
      description: "프로필 카드 보기 (누구나 조회 가능)",
      run(args) {
        const s = S.get();
        const target = args[0] || "나";
        const p = target === "나" ? s.profile : s.users[target] && s.users[target].profile;
        if (!p) return errorEmbed(`"${target}"의 프로필을 찾을 수 없어요. 유저1, 유저2, 유저3 중에서 골라봐.`);
        return embed(
          "default",
          `🪪 프로필${target !== "나" ? " · " + target : ""}`,
          [],
          Object.entries(p).map(([label, value]) => ({ label, value })),
          "채널에 공개되는 카드입니다"
        );
      },
    },
    {
      name: "/위키 조회",
      args: "[대상]",
      description: "멤버 TMI 카드 보기 (누구나 조회 가능)",
      run(args) {
        const s = S.get();
        const target = args[0] || "나";
        const w = target === "나" ? s.wiki["나"] : s.users[target] && s.users[target].wiki;
        if (!w) return errorEmbed(`"${target}"의 위키 항목을 찾을 수 없어요.`);
        return embed("default", `📖 위키 · ${target}`, [`좌우명: ${w.좌우명}`, `서식지: ${w.서식지}`, `MBTI: ${w.mbti}`, `TMI: ${w.tmi}`]);
      },
    },
    {
      name: "/위키 목록",
      description: "서버 멤버 위키 목록",
      run() {
        return embed("default", "📖 위키 목록", ["나 · 유저1 · 유저2 · 유저3", "각 이름으로 /위키 조회 이름 을 써보세요"]);
      },
    },
    {
      name: "/생일 등록",
      args: "년 월 일",
      description: "본인 생일 등록 (나만 보임)",
      run(args) {
        const s = S.get();
        if (s.birthday) return errorEmbed("이미 생일이 등록돼 있어. /생일 변경을 써줘.");
        const [y, m, d] = args.map(Number);
        if (![y, m, d].every(Number.isFinite)) return errorEmbed("사용법: /생일 등록 년 월 일  (예: /생일 등록 2000 7 24)");
        s.birthday = { y, m, d };
        return embed("default", "🎂 생일 등록 완료", [`${y}년 ${m}월 ${d}일로 등록했어요.`]);
      },
    },
    {
      name: "/생일 변경",
      args: "년 월 일",
      description: "등록된 생일 변경 (나만 보임)",
      run(args) {
        const s = S.get();
        const [y, m, d] = args.map(Number);
        if (![y, m, d].every(Number.isFinite)) return errorEmbed("사용법: /생일 변경 년 월 일");
        s.birthday = { y, m, d };
        return embed("default", "🎂 생일 변경 완료", [`${y}년 ${m}월 ${d}일로 바꿨어요.`]);
      },
    },
    {
      name: "/생일 삭제",
      description: "등록된 생일 삭제 (나만 보임)",
      run() {
        const s = S.get();
        if (!s.birthday) return errorEmbed("등록된 생일이 없어요.");
        s.birthday = null;
        return embed("default", "🎂 생일 삭제 완료", ["생일 정보를 지웠어요."]);
      },
    },
    {
      name: "/생일 확인",
      args: "[멤버]",
      description: "멤버 생일 확인 (채널에 공개)",
      run() {
        const s = S.get();
        if (!s.birthday) return embed("default", "🎂 생일 확인", ["아직 등록된 생일이 없어요."]);
        return embed("default", "🎂 생일 확인", [`체험유저님의 생일: ${s.birthday.m}월 ${s.birthday.d}일`]);
      },
    },
    {
      name: "/아이디 조회",
      args: "[대상]",
      description: "등록된 게임 아이디 확인 (채널에 공개)",
      run(args) {
        const s = S.get();
        const target = args[0] || "나";
        const list = s.registeredIds[target];
        if (!list || !list.length) return embed("default", "🎮 아이디 조회", [`"${target}"에게 등록된 아이디가 없어요.`]);
        return embed("default", `🎮 아이디 조회 · ${target}`, list.map((r) => `${r.platform}: ${r.value}`));
      },
    },
  ];

  // ============ 홍보 집계 · 스누즈 ============
  const upSnoozeCommands = [
    {
      name: "/업 순위",
      description: "홍보 봇 사용 횟수 순위",
      run() {
        const s = S.get();
        return embed("default", "📣 업 순위", s.up.ranking.map((r, i) => `${i + 1}위 ${r.name} — ${r.count}회`), [], "성공한 것만 집계돼요");
      },
    },
    {
      name: "/업 상세내역",
      description: "날짜별 홍보 내역",
      run() {
        const s = S.get();
        return embed("default", "📣 업 상세내역", s.up.daily.map((d) => `${d.date}: ${d.entries.join(", ")}`));
      },
    },
    {
      name: "/스누즈 예약",
      args: "시간 메모",
      description: "메시지를 미뤄뒀다가 나중에 다시 받기 (데모용 간이 버전)",
      run(args) {
        const s = S.get();
        const blocked = needFeature("나중에답장");
        if (blocked) return blocked;
        if (s.snoozes.length >= 50) return errorEmbed("한 사람당 최대 50개까지만 쌓아둘 수 있어요.");
        const time = args[0];
        const memo = args.slice(1).join(" ") || "(메모 없음)";
        if (!time) return errorEmbed("사용법: /스누즈 예약 시간 메모  (예: /스누즈 예약 2시간 이 얘기 마저 하기)");
        const entry = { id: s.snoozeSeq, time, memo };
        s.snoozeSeq += 1;
        s.snoozes.push(entry);
        return embed("default", "⏰ 예약 완료", [`${time} 뒤에 DM으로 다시 알려줄게요.`], [], `취소하려면 /스누즈 취소 ${entry.id}`);
      },
    },
    {
      name: "/스누즈 목록",
      description: "미뤄둔 메시지 확인 (나만 보임)",
      run() {
        const s = S.get();
        if (!s.snoozes.length) return embed("default", "⏰ 스누즈 목록", ["예약된 게 없어요."]);
        return embed("default", "⏰ 스누즈 목록", s.snoozes.map((sn) => `#${sn.id} · ${sn.time} · ${sn.memo}`));
      },
    },
    {
      name: "/스누즈 취소",
      args: "번호",
      description: "예약 취소",
      run(args) {
        const s = S.get();
        const id = Number((args[0] || "").replace("#", ""));
        const idx = s.snoozes.findIndex((sn) => sn.id === id);
        if (idx === -1) return errorEmbed("그 번호의 예약을 찾을 수 없어요.");
        s.snoozes.splice(idx, 1);
        return embed("default", "⏰ 취소 완료", [`#${id} 예약을 취소했어요.`]);
      },
    },
  ];

  // ============ 마리기억 (AI 잡담 채널) ============
  const memoryCommands = [
    {
      name: "/마리기억 목록",
      description: "마리가 나에 대해 기억 중인 내용 (나만 보임)",
      run() {
        const s = S.get();
        if (!s.memory.length) return embed("default", "🧠 마리기억", ["아직 기억해둔 게 없어요."]);
        return embed("default", "🧠 마리기억", s.memory.map((m) => `#${m.id} ${m.text}`));
      },
    },
    {
      name: "/마리기억 삭제",
      args: "번호",
      description: "기억 하나 지우기",
      run(args) {
        const s = S.get();
        const id = Number(args[0]);
        const idx = s.memory.findIndex((m) => m.id === id);
        if (idx === -1) return errorEmbed("그 번호의 기억을 찾을 수 없어요.");
        s.memory.splice(idx, 1);
        return embed("default", "🧠 삭제 완료", [`#${id} 기억을 지웠어요.`]);
      },
    },
    {
      name: "/마리기억 초기화",
      description: "기억 전부 지우기",
      run() {
        const s = S.get();
        s.memory = [];
        return embed("default", "🧠 초기화 완료", ["기억을 전부 지웠어요."]);
      },
    },
  ];

  // ============ 기타 ============
  const miscCommands = [
    {
      name: "/통계",
      description: "서버 활동 요약",
      run() {
        const s = S.get();
        return embed(
          "default",
          "📊 서버 통계",
          [
            `총 유통 에바: ${S.formatEva(482300)}`,
            `평균 잔고: ${S.formatEva(9800)} · 중앙값: ${S.formatEva(6200)}`,
            "상위 10명 점유율: 41%",
            `현재 상장 종목: ${s.stocks.length}개`,
          ],
          [],
          "⚠️ 실제 봇은 이 명령어에 권한 체크가 빠져 있어 누구나 실행 가능합니다"
        );
      },
    },
    {
      name: "/기능제어 상태",
      description: "기능 정지 상태 확인 (권한 불필요)",
      run() {
        const s = S.get();
        return embed("default", "⚙️ 기능제어 상태", Object.entries(s.featureFlags).map(([k, v]) => `${v ? "🟢" : "🔴"} ${k}`));
      },
    },
  ];

  // ============ 관리자 전용 ============
  const adminCommands = [
    {
      name: "/기능제어 정지",
      args: "기능명",
      description: "기능 정지",
      adminOnly: true,
      run(args) {
        const s = S.get();
        const key = args[0];
        if (!(key in s.featureFlags)) return errorEmbed("존재하는 기능명이 아니에요. /기능제어 상태로 목록을 확인해줘.");
        s.featureFlags[key] = false;
        S.notify();
        return embed("admin", "🛠 기능 정지", [`"${key}" 기능을 정지했어요. 다른 채널에서 바로 막히는지 확인해보세요.`]);
      },
    },
    {
      name: "/기능제어 재개",
      args: "기능명",
      description: "기능 재개",
      adminOnly: true,
      run(args) {
        const s = S.get();
        const key = args[0];
        if (!(key in s.featureFlags)) return errorEmbed("존재하는 기능명이 아니에요. /기능제어 상태로 목록을 확인해줘.");
        s.featureFlags[key] = true;
        S.notify();
        return embed("admin", "🛠 기능 재개", [`"${key}" 기능을 다시 켰어요.`]);
      },
    },
    {
      name: "/지급",
      args: "대상 금액",
      description: "멤버에게 에바 지급 (대상: 나 / 유저1~3)",
      adminOnly: true,
      run(args) {
        const [target, amountStr] = args;
        const amount = Number(amountStr);
        if (!target || !Number.isFinite(amount)) return errorEmbed("사용법: /지급 대상 금액  (예: /지급 유저1 1000)");
        const s = S.get();
        if (target === "나") {
          s.wallet.balance += amount;
          S.addHistory("관리자 지급", amount, "관리자가 나에게 지급");
        } else {
          const u = s.users[target];
          if (!u) return errorEmbed(`"${target}"을(를) 찾을 수 없어요. 나, 유저1, 유저2, 유저3 중에서 골라봐.`);
          u.wallet += amount;
        }
        S.notify();
        return embed("admin", "🛠 지급 완료", [`${target}에게 ${S.formatEva(amount)}를 지급했어요.`]);
      },
    },
    {
      name: "/상점 생성",
      args: "아이템 가격",
      description: "매대에 새 상품 추가",
      adminOnly: true,
      run(args) {
        const [name, priceStr] = args;
        const price = Number(priceStr);
        if (!name || !Number.isFinite(price)) return errorEmbed("사용법: /상점 생성 아이템 가격");
        const s = S.get();
        s.shop.push({ id: name, name, price, resalePercent: 50, stock: 10, roleItem: false });
        S.notify();
        return embed("admin", "🛠 상품 등록", [`"${name}"을(를) ${S.formatEva(price)}에 매대에 등록했어요.`]);
      },
    },
    {
      name: "/주식 생성",
      args: "종목 가격",
      description: "새 종목 상장",
      adminOnly: true,
      run(args) {
        const [name, priceStr] = args;
        const price = Number(priceStr);
        if (!name || !Number.isFinite(price)) return errorEmbed("사용법: /주식 생성 종목 가격");
        const s = S.get();
        if (s.stocks.some((st) => st.name === name)) return errorEmbed("이미 있는 종목명이에요.");
        s.stocks.push({ name, price, prevClose: price, open: true, history: [price], closings: 0 });
        S.notify();
        return embed("admin", "🛠 상장 완료", [`"${name}"을(를) ${S.formatEva(price)}로 상장했어요.`]);
      },
    },
    {
      name: "/주식 삭제",
      args: "종목",
      description: "종목 상장폐지",
      adminOnly: true,
      run(args) {
        const s = S.get();
        const idx = s.stocks.findIndex((st) => st.name === args[0]);
        if (idx === -1) return errorEmbed("그 종목을 찾을 수 없어요.");
        s.stocks.splice(idx, 1);
        S.notify();
        return embed("admin", "🛠 상장폐지", [`"${args[0]}"을(를) 상장폐지했어요.`]);
      },
    },
    {
      name: "/주식 변동",
      args: "종목 등락률(%)",
      description: "특정 종목 시세 강제 변동",
      adminOnly: true,
      run(args) {
        const [name, pctStr] = args;
        const pct = Number(pctStr);
        const s = S.get();
        const stock = s.stocks.find((st) => st.name === name);
        if (!stock || !Number.isFinite(pct)) return errorEmbed("사용법: /주식 변동 종목 등락률  (예: /주식 변동 은하전자 -10)");
        stock.prevClose = stock.price;
        stock.price = Math.max(100, Math.round(stock.price * (1 + pct / 100)));
        stock.history.push(stock.price);
        S.notify();
        return embed("admin", "🛠 시세 변동 적용", [`${name} 가격을 ${pct > 0 ? "+" : ""}${pct}% 조정했어요.`]);
      },
    },
    {
      name: "/주식 종가게시",
      description: "전 종목 종가를 게시 (그래프 표시 조건 충족용)",
      adminOnly: true,
      run() {
        const s = S.get();
        s.stocks.forEach((st) => { st.closings = (st.closings || 0) + 1; });
        return embed("admin", "🛠 종가게시 완료", [`전 종목 종가를 게시했어요. (누적 ${s.stocks[0]?.closings || 0}회)`]);
      },
    },
    {
      name: "/주식 지급",
      args: "대상 종목 수량",
      description: "특정 대상에게 주식 직접 지급 (대상: 나 / 유저1~3)",
      adminOnly: true,
      run(args) {
        const [target, name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        if (!s.stocks.some((st) => st.name === name) || !Number.isFinite(qty)) return errorEmbed("사용법: /주식 지급 대상 종목 수량");
        const portfolio = target === "나" ? s.portfolio : s.users[target] && s.users[target].portfolio;
        if (!portfolio) return errorEmbed(`"${target}"을(를) 찾을 수 없어요. 나, 유저1, 유저2, 유저3 중에서 골라봐.`);
        portfolio[name] = (portfolio[name] || 0) + qty;
        S.notify();
        return embed("admin", "🛠 주식 지급", [`${target}에게 ${name} ${qty}주를 지급했어요.`]);
      },
    },
    {
      name: "/주식 회수",
      args: "대상 종목 수량",
      description: "특정 대상의 주식 회수 (대상: 나 / 유저1~3)",
      adminOnly: true,
      run(args) {
        const [target, name, qtyStr] = args;
        const qty = Number(qtyStr);
        const s = S.get();
        if (!Number.isFinite(qty)) return errorEmbed("사용법: /주식 회수 대상 종목 수량");
        const portfolio = target === "나" ? s.portfolio : s.users[target] && s.users[target].portfolio;
        if (!portfolio) return errorEmbed(`"${target}"을(를) 찾을 수 없어요. 나, 유저1, 유저2, 유저3 중에서 골라봐.`);
        const holding = portfolio[name] || 0;
        portfolio[name] = Math.max(0, holding - qty);
        S.notify();
        return embed("admin", "🛠 주식 회수", [`${target}의 ${name} ${qty}주를 회수했어요.`]);
      },
    },
    {
      name: "/주식 개장",
      description: "전 종목 강제 개장",
      adminOnly: true,
      run() {
        const s = S.get();
        s.stocks.forEach((st) => { st.open = true; });
        S.notify();
        return embed("admin", "🛠 개장", ["전 종목을 개장했어요."]);
      },
    },
    {
      name: "/주식 폐장",
      description: "전 종목 강제 폐장",
      adminOnly: true,
      run() {
        const s = S.get();
        s.stocks.forEach((st) => { st.open = false; });
        S.notify();
        return embed("admin", "🛠 폐장", ["전 종목을 폐장했어요."]);
      },
    },
    {
      name: "/캠프 세금환수",
      description: "미납자 포함 이번 회차 세금 강제 환수",
      adminOnly: true,
      run() {
        const s = S.get();
        if (s.campTax.paid) {
          s.campTax.paid = false;
          return embed("admin", "🛠 세금환수", ["이미 자진납부돼 있어서 추가로 걷지 않았어요. 납부 기록을 초기화했어요."]);
        }
        const tax = Math.max(0, Math.round(s.wallet.balance * s.campTax.rate));
        s.wallet.balance -= tax;
        s.campTax.treasury += tax;
        S.addHistory("캠프통장 회수", -tax, `${s.campTax.camp} 캠프 세금 환수`);
        s.campTax.paid = false;
        S.notify();
        return embed("admin", "🛠 세금환수 완료", [`미납자에게서 ${S.formatEva(tax)}를 강제로 걷었어요. 잔고가 모자라면 마이너스가 될 수 있어요.`]);
      },
    },
    {
      name: "/캠프 회수",
      args: "금액",
      description: "캠프 통장에서 금액 회수",
      adminOnly: true,
      run(args) {
        const amount = Number(args[0]);
        const s = S.get();
        if (!Number.isFinite(amount) || amount <= 0) return errorEmbed("사용법: /캠프 회수 금액");
        s.campTax.treasury = Math.max(0, s.campTax.treasury - amount);
        return embed("admin", "🛠 캠프 회수", [`캠프 통장에서 ${S.formatEva(amount)}를 회수했어요. (잔여 ${S.formatEva(s.campTax.treasury)})`]);
      },
    },
    {
      name: "/견학 보내기",
      args: "신청번호",
      description: "대기 중인 견학 신청 발송 처리",
      adminOnly: true,
      run(args) {
        const s = S.get();
        const id = Number(args[0]);
        const req = s.tourRequests.find((r) => r.id === id);
        if (!req) return errorEmbed("그 번호의 신청을 찾을 수 없어요.");
        req.status = "발송완료";
        return embed("admin", "🛠 견학 발송", [`#${id} (${req.camp}) 신청을 발송 처리했어요.`]);
      },
    },
    {
      name: "/역할부여",
      args: "대상 역할명",
      description: "멤버에게 역할 부여",
      adminOnly: true,
      run(args) {
        const [target, role] = args;
        if (!target || !role) return errorEmbed("사용법: /역할부여 대상 역할명");
        const s = S.get();
        s.grantedRoles.push({ target, role });
        return embed("admin", "🛠 역할 부여", [`${target}에게 "${role}" 역할을 부여했어요.`]);
      },
    },
    {
      name: "/명단",
      description: "서버 멤버 명단 보기",
      adminOnly: true,
      run() {
        const s = S.get();
        return embed("admin", "🛠 명단", s.roster.map((r) => `${r.name} · ${r.camp} · ${r.role}`));
      },
    },
    {
      name: "/감사로그",
      description: "최근 관리자 작업 로그",
      adminOnly: true,
      run() {
        const s = S.get();
        if (!s.auditLog.length) return embed("admin", "🛠 감사로그", ["아직 기록된 작업이 없어요."]);
        return embed("admin", "🛠 감사로그", s.auditLog.slice(0, 15).map((a) => a.text));
      },
    },
    {
      name: "/프로필설정",
      args: "필드 값",
      description: "프로필 카드 필드 수정",
      adminOnly: true,
      run(args) {
        const [field, ...rest] = args;
        const value = rest.join(" ");
        if (!field || !value) return errorEmbed("사용법: /프로필설정 필드 값  (예: /프로필설정 소속캠프 나래)");
        const s = S.get();
        s.profile[field] = value;
        return embed("admin", "🛠 프로필 수정", [`"${field}"을(를) "${value}"로 바꿨어요.`]);
      },
    },
    {
      name: "/연대기",
      args: "내용",
      description: "서버 연대기에 조용히 기록 남기기 (일반 도움말엔 안 뜸)",
      adminOnly: true,
      run(args) {
        if (!args.length) return errorEmbed("사용법: /연대기 내용");
        const s = S.get();
        s.chronicle.push({ text: args.join(" "), ts: Date.now() });
        return embed("admin", "🛠 연대기 기록", ["기록을 남겼어요. (유저에게는 노출되지 않아요)"]);
      },
    },
    {
      name: "/아이디 등록",
      args: "대상 플랫폼 값",
      description: "대상의 게임 아이디 등록",
      adminOnly: true,
      run(args) {
        const [target, platform, value] = args;
        if (!target || !platform || !value) return errorEmbed("사용법: /아이디 등록 대상 플랫폼 값");
        const s = S.get();
        if (!s.registeredIds[target]) s.registeredIds[target] = [];
        s.registeredIds[target].push({ platform, value });
        return embed("admin", "🛠 아이디 등록", [`${target}의 ${platform} 아이디를 등록했어요.`]);
      },
    },
    {
      name: "/아이디 수정",
      args: "대상 플랫폼 값",
      description: "대상의 게임 아이디 수정",
      adminOnly: true,
      run(args) {
        const [target, platform, value] = args;
        const s = S.get();
        const list = s.registeredIds[target];
        const row = list && list.find((r) => r.platform === platform);
        if (!row) return errorEmbed("수정할 대상의 등록된 아이디를 찾을 수 없어요.");
        row.value = value;
        return embed("admin", "🛠 아이디 수정", [`${target}의 ${platform} 아이디를 "${value}"로 바꿨어요.`]);
      },
    },
    {
      name: "/아이디 삭제",
      args: "대상 플랫폼",
      description: "대상의 게임 아이디 삭제",
      adminOnly: true,
      run(args) {
        const [target, platform] = args;
        const s = S.get();
        const list = s.registeredIds[target];
        if (!list) return errorEmbed("등록된 아이디가 없어요.");
        const idx = list.findIndex((r) => r.platform === platform);
        if (idx === -1) return errorEmbed("그 플랫폼의 등록 정보를 찾을 수 없어요.");
        list.splice(idx, 1);
        return embed("admin", "🛠 아이디 삭제", [`${target}의 ${platform} 아이디를 지웠어요.`]);
      },
    },
    {
      name: "/아이디 전체조회",
      description: "등록된 모든 아이디 조회",
      adminOnly: true,
      run() {
        const s = S.get();
        const lines = Object.entries(s.registeredIds)
          .filter(([, list]) => list.length)
          .map(([target, list]) => `${target}: ${list.map((r) => `${r.platform}=${r.value}`).join(", ")}`);
        return embed("admin", "🛠 아이디 전체조회", lines.length ? lines : ["등록된 아이디가 없어요."]);
      },
    },
    {
      name: "/위키 등록",
      args: "내용",
      description: "위키 TMI 항목 등록",
      adminOnly: true,
      run(args) {
        if (!args.length) return errorEmbed("사용법: /위키 등록 내용");
        S.get().wiki["나"].tmi = args.join(" ");
        return embed("admin", "🛠 위키 등록", ["TMI 항목을 갱신했어요."]);
      },
    },
    {
      name: "/위키 수정",
      args: "필드 값",
      description: "위키 특정 필드 수정",
      adminOnly: true,
      run(args) {
        const [field, ...rest] = args;
        const value = rest.join(" ");
        if (!field || !value) return errorEmbed("사용법: /위키 수정 필드 값  (예: /위키 수정 mbti INTJ)");
        S.get().wiki["나"][field] = value;
        return embed("admin", "🛠 위키 수정", [`"${field}"을(를) "${value}"로 바꿨어요.`]);
      },
    },
    {
      name: "/위키 삭제",
      args: "대상",
      description: "대상의 위키 항목 삭제 (대상: 나 / 유저1~3)",
      adminOnly: true,
      run(args) {
        const target = args[0];
        const s = S.get();
        if (target === "나") {
          if (!s.wiki["나"]) return errorEmbed("삭제할 위키 항목을 찾을 수 없어요.");
          delete s.wiki["나"];
        } else {
          if (!target || !s.users[target] || !s.users[target].wiki) return errorEmbed("삭제할 위키 항목을 찾을 수 없어요.");
          delete s.users[target].wiki;
        }
        return embed("admin", "🛠 위키 삭제", [`${target}의 위키 항목을 지웠어요.`]);
      },
    },
    {
      name: "/설정 출석보상",
      args: "금액",
      description: "출석 보상 금액 변경",
      adminOnly: true,
      run(args) {
        const amount = Number(args[0]);
        if (!Number.isFinite(amount) || amount <= 0) return errorEmbed("사용법: /설정 출석보상 금액");
        const s = S.get();
        s.attendance.reward = amount;
        return embed("admin", "🛠 설정 변경", [`출석 보상을 ${S.formatEva(amount)}로 바꿨어요.`]);
      },
    },
    {
      name: "/설정 복권가격",
      args: "금액",
      description: "복권 티켓 가격 변경",
      adminOnly: true,
      run(args) {
        const amount = Number(args[0]);
        if (!Number.isFinite(amount) || amount <= 0) return errorEmbed("사용법: /설정 복권가격 금액");
        const s = S.get();
        s.lottery.ticketPrice = amount;
        return embed("admin", "🛠 설정 변경", [`복권 티켓 가격을 ${S.formatEva(amount)}로 바꿨어요.`]);
      },
    },
    {
      name: "/테스트 마리상태",
      description: "AI 호출 한도 확인",
      adminOnly: true,
      run() {
        return embed("admin", "🛠 마리 상태", ["분당 호출: 3/8 (RPM)", "오늘 호출: 41/200 (RPD)"]);
      },
    },
  ];

  // ============ 도움말 ============
  // 채널에 들어오자마자 전부 뿌려주지 않고, /도움말을 직접 치도록 유도한다.
  // 관리자 모드 여부에 따라 결과가 달라진다는 걸 눈에 띄게 알려준다.
  function buildHelpEmbed(isAdminCtx) {
    const list = CHANNELS.filter((c) => c.id !== "help" && (isAdminCtx || !c.adminOnly));
    const lines = [];
    list.forEach((c) => {
      lines.push(`▸ #${c.name} — ${c.intro}`);
      if (c.highlights && c.highlights.length) {
        lines.push(`    예: ${c.highlights.join(", ")}`);
      }
    });
    const footer = isAdminCtx
      ? "🛠 지금 관리자 모드로 보고 있어서, 유저에게는 안 보이는 #관리자-전용 카테고리까지 함께 표시했어요."
      : "🔒 지금은 유저 모드예요. 우측 상단 토글로 관리자 모드를 켜고 /도움말을 다시 치면 #관리자-전용 카테고리도 볼 수 있어요.";
    return embed("default", isAdminCtx ? "📚 도움말 (관리자 모드)" : "📚 도움말", lines, [], footer);
  }

  const helpCommands = [
    {
      name: "/도움말",
      description: "카테고리별 명령어 안내 (관리자 모드면 내용이 달라져요)",
      run(args, ctx) {
        return buildHelpEmbed(ctx.admin);
      },
    },
  ];

  // ============ 채널 정의 ============
  const CHANNELS = [
    {
      id: "help",
      name: "도움말",
      type: "commands",
      commands: helpCommands,
      intro: "여기서 /도움말을 쳐보세요. 관리자 모드 켰을 때랑 껐을 때 결과가 달라요!",
    },
    { id: "chat", name: "마리-대화", type: "chat", commands: memoryCommands, highlights: ["/마리기억 목록"], intro: "마리를 멘션하듯 자유롭게 말을 걸어보세요. 슬래시 명령어는 /마리기억 계열만 여기서 써요." },
    { id: "wallet", name: "지갑-경제", type: "commands", commands: walletCommands, highlights: ["/지갑", "/출석", "/송금"], intro: "지갑, 송금, 출석, 캠프 세금을 체험할 수 있어요." },
    { id: "stock", name: "주식", type: "commands", commands: stockCommands, highlights: ["/주식 목록", "/주식 매수", "/주식 포폴"], intro: "시세는 4초마다 자동으로 움직여요. /주식 목록으로 먼저 확인해보세요." },
    { id: "shop", name: "상점", type: "commands", commands: shopCommands, highlights: ["/상점 목록", "/상점 구매"], intro: "/상점 목록으로 매대를 확인하고 구매/되팔기/선물/견학신청을 해보세요." },
    { id: "lottery", name: "복권", type: "commands", commands: lotteryCommands, highlights: ["/복권 구매", "/복권 당첨확인"], intro: "복권을 사고 /복권 당첨확인으로 바로 추첨 결과를 볼 수 있어요." },
    { id: "minigame", name: "미니게임", type: "commands", commands: minigameCommands, highlights: ["/하이로우", "/고확"], intro: "/하이로우로 판을 연 다음 /하이 또는 /로우로 맞혀보세요. \"에바시\"라고만 쳐도 반응해요!" },
    { id: "profile", name: "프로필-위키", type: "commands", commands: profileCommands, highlights: ["/프로필", "/위키 조회", "/생일 확인"], intro: "프로필, 위키, 생일, 아이디 조회를 체험할 수 있어요." },
    { id: "idregister", name: "아이디등록", type: "idregister", intro: "여기서는 명령어 없이 그냥 '플랫폼 아이디' 형식으로 채팅을 치면 마리가 알아서 등록해요. 예: 라이엇 만해#kr1" },
    { id: "up-snooze", name: "홍보-스누즈", type: "commands", commands: upSnoozeCommands, highlights: ["/업 순위", "/스누즈 예약"], intro: "홍보 집계 순위와 나중에 답장(스누즈) 기능을 체험할 수 있어요." },
    { id: "misc", name: "기타", type: "commands", commands: miscCommands, highlights: ["/통계", "/기능제어 상태"], intro: "특정 카테고리에 딱 들어맞지 않는 기능들을 모아뒀어요." },
    { id: "admin", name: "관리자-전용", type: "commands", commands: adminCommands, adminOnly: true, highlights: ["/기능제어 정지", "/지급", "/주식 변동"], intro: "관리자 모드에서만 보이는 채널이에요. 여기서 바꾼 값은 다른 채널에 실시간으로 반영돼요." },
  ];

  // ============ 특수: 아이디 자동등록 (슬래시 명령어 아님) ============
  function registerId(text) {
    const s = S.get();
    if (!s.featureFlags.아이디) return errorEmbed("아이디 기능은 지금 정지돼 있어요.");
    let body = text.trim();
    let isEdit = false;
    if (/^(변경|수정)\s+/.test(body)) {
      isEdit = true;
      body = body.replace(/^(변경|수정)\s+/, "");
    }
    const looksLikeId = /#/.test(body) || /\d{4,}/.test(body) || Object.keys(PLATFORM_ALIASES).some((k) => body.includes(k));
    if (!looksLikeId) return null; // 그냥 잡담은 무시 (아이디 시도로 보지 않음)

    const match = body.match(/^([^\s:]+)\s*[:\s]\s*(.+)$/);
    if (!match) return errorEmbed("형식을 못 알아봤어요. \"플랫폼 아이디\" 형식으로 다시 써줘. (예: 라이엇 만해#kr1)");
    const rawPlatform = match[1];
    const value = match[2].trim();
    const platform = PLATFORM_ALIASES[rawPlatform] || rawPlatform;
    if (!s.registeredIds["나"]) s.registeredIds["나"] = [];
    const list = s.registeredIds["나"];
    const existing = list.find((r) => r.platform === platform);
    if (isEdit) {
      if (!existing) return errorEmbed(`아직 등록되지 않은 플랫폼(${platform})은 변경할 수 없어요. 먼저 등록해줘.`);
      return embed("default", "🆔 아이디 변경 대기", [`"${platform}: ${value}"로 변경 요청을 남겼어요.`], [], "변경은 항상 관리자 승인을 거쳐요 (DM으로 결과 안내)");
    }
    if (existing) return errorEmbed(`이미 등록된 플랫폼이에요. 바꾸려면 앞에 "변경"을 붙여줘. 예: 변경 ${rawPlatform} ${value}`);
    list.push({ platform, value });
    return embed("default", "🆔 아이디 등록 완료", [`${platform}: ${value}`], [], "원본 메시지는 자동으로 삭제되고 결과는 DM으로 가요 (데모라 여기 바로 보여줄게요)");
  }

  // ============ 특수: 에바시 이벤트 (아무 명령어 채널에서나 키워드로 동작) ============
  function evashi() {
    const s = S.get();
    const now = Date.now();
    if (now - s.evashi.lastClaim < 10000) {
      return errorEmbed("이미 참여했어요! 다음 창을 기다려주세요. (데모는 10초 쿨다운)");
    }
    s.evashi.lastClaim = now;
    const reward = 100 + Math.floor(Math.random() * 200);
    s.wallet.balance += reward;
    S.addHistory("에바시 보상", reward, "에바시 이벤트 참여");
    S.notify();
    return embed("default", "🎉 에바시!", [`참여 성공! ${S.formatEva(reward)}를 받았어요.`], [], "실제로는 하루 두 번(00:21, 12:21) 열려요");
  }

  function allCommandsFor(channel, isAdmin) {
    if (!channel.commands) return [];
    return channel.commands.filter((c) => isAdmin || !c.adminOnly);
  }

  function parse(input, channel) {
    const trimmed = input.trim();
    const candidates = channel.commands.slice().sort((a, b) => b.name.length - a.name.length);
    for (const cmd of candidates) {
      if (trimmed === cmd.name || trimmed.startsWith(cmd.name + " ")) {
        const rest = trimmed.slice(cmd.name.length).trim();
        const args = rest.length ? rest.split(/\s+/) : [];
        return { cmd, args };
      }
    }
    return null;
  }

  function execute(input, channel, isAdminCtx) {
    const parsed = parse(input, channel);
    if (!parsed) {
      const names = channel.commands.map((c) => c.name).join(", ");
      return errorEmbed(`이 채널에서는 그 명령어를 못 써. 사용 가능한 명령어: ${names}`);
    }
    if (parsed.cmd.adminOnly && !isAdminCtx) {
      return errorEmbed("이 명령어는 관리자 전용이야. 우측 상단 토글을 켜고 다시 시도해줘.");
    }
    const result = parsed.cmd.run(parsed.args, { admin: isAdminCtx });
    if (parsed.cmd.adminOnly && result && result.tone !== "error") {
      S.addAudit(`${parsed.cmd.name} ${parsed.args.join(" ")}`.trim());
    }
    return result;
  }

  return { CHANNELS, allCommandsFor, execute, registerId, evashi };
})();
